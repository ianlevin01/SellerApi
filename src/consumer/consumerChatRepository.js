import db from "../database/db.js";

export async function createConversation({ seller_id, consumer_email, consumer_name, consumer_phone, access_token, subject, order_items, grand_total, shipping_info, store_slug }) {
  const { rows } = await db.query(
    `INSERT INTO consumer_conversations
       (seller_id, consumer_email, consumer_name, consumer_phone, access_token, subject, order_items, grand_total, shipping_info, store_slug)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [seller_id, consumer_email, consumer_name, consumer_phone || null, access_token, subject,
     JSON.stringify(order_items || []), grand_total || 0, JSON.stringify(shipping_info || {}), store_slug || null]
  );
  return rows[0];
}

export async function getConversationById(id) {
  const { rows } = await db.query(`SELECT * FROM consumer_conversations WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function getConversationByToken(id, token) {
  const { rows } = await db.query(
    `SELECT * FROM consumer_conversations WHERE id = $1 AND access_token = $2`,
    [id, token]
  );
  return rows[0] || null;
}

export async function getMessages(conversation_id) {
  const { rows } = await db.query(
    `SELECT * FROM consumer_messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [conversation_id]
  );
  return rows;
}

export async function addMessage(conversation_id, sender, body) {
  const { rows } = await db.query(
    `INSERT INTO consumer_messages (conversation_id, sender, body) VALUES ($1,$2,$3) RETURNING *`,
    [conversation_id, sender, body]
  );
  await db.query(
    `UPDATE consumer_conversations SET updated_at = now() WHERE id = $1`,
    [conversation_id]
  );
  return rows[0];
}

export async function markAdminMessagesRead(conversation_id) {
  await db.query(
    `UPDATE consumer_messages SET read_at = now()
     WHERE conversation_id = $1 AND sender = 'admin' AND read_at IS NULL`,
    [conversation_id]
  );
}

export async function markConsumerMessagesRead(conversation_id) {
  await db.query(
    `UPDATE consumer_messages SET read_at = now()
     WHERE conversation_id = $1 AND sender = 'consumer' AND read_at IS NULL`,
    [conversation_id]
  );
}

export async function getAllConversations() {
  const { rows } = await db.query(
    `SELECT cc.*,
       (SELECT COUNT(*) FROM consumer_messages cm
        WHERE cm.conversation_id = cc.id AND cm.sender = 'consumer' AND cm.read_at IS NULL
       ) AS unread_count,
       (SELECT body FROM consumer_messages cm
        WHERE cm.conversation_id = cc.id ORDER BY cm.created_at DESC LIMIT 1
       ) AS last_message
     FROM consumer_conversations cc
     ORDER BY cc.updated_at DESC`
  );
  return rows;
}

export async function getSlugBySellerId(seller_id) {
  const { rows } = await db.query(
    `SELECT slug FROM seller_pages WHERE seller_id = $1 LIMIT 1`,
    [seller_id]
  );
  return rows[0]?.slug || null;
}

export async function createConsultationOrder({ seller_id, customer, items, total, shipping }) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `INSERT INTO web_orders
         (customer_name, customer_email, customer_phone, customer_city, observaciones, total, seller_id, shipping_amount, free_shipping_absorbed, color)
       VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,'consultation')
       RETURNING *`,
      [customer.name, customer.email, customer.phone || null, customer.city || null, customer.notes || null, total || 0, seller_id]
    );
    const order = rows[0];

    for (const item of (items || [])) {
      await client.query(
        `INSERT INTO web_order_items (web_order_id, product_id, name, quantity, unit_price)
         VALUES ($1,$2,$3,$4,$5)`,
        [order.id, item.product_id || null, item.name, item.quantity, item.unit_price]
      );
    }

    if (shipping?.type) {
      await client.query(
        `INSERT INTO order_shipping
           (web_order_id, shipping_type, postal_code, province, city, service_name)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [order.id, shipping.type, shipping.postal_code || null, shipping.province || null, shipping.city || null, shipping.service_name || null]
      );
    }

    await client.query("COMMIT");
    return order;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// src/modules/chat/chatRepository.js
import pool from "../database/db.js";
import crypto from "crypto";

export async function findOrCreateConversation(sellerId, { customer_name, customer_email, customer_phone }) {
  if (customer_email) {
    const { rows: existing } = await pool.query(
      `SELECT id, access_token FROM conversations
       WHERE seller_id = $1 AND customer_email = $2`,
      [sellerId, customer_email]
    );
    if (existing[0]) return existing[0];
  }

  const access_token = crypto.randomBytes(32).toString("hex");
  const { rows } = await pool.query(
    `INSERT INTO conversations (seller_id, customer_name, customer_email, customer_phone, access_token)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, access_token`,
    [sellerId, customer_name, customer_email || null, customer_phone || null, access_token]
  );
  return rows[0];
}

export async function getConversationByToken(conversationId, accessToken) {
  const { rows } = await pool.query(
    `SELECT id, seller_id, customer_name FROM conversations
     WHERE id = $1 AND access_token = $2`,
    [conversationId, accessToken]
  );
  return rows[0] || null;
}

export async function getConversationById(conversationId, sellerId) {
  const { rows } = await pool.query(
    `SELECT id, customer_name, customer_email, customer_phone, created_at
     FROM conversations WHERE id = $1 AND seller_id = $2`,
    [conversationId, sellerId]
  );
  return rows[0] || null;
}

export async function getMessages(conversationId) {
  const { rows } = await pool.query(
    `SELECT id, sender, body, msg_type, quote_data, created_at, read_at
     FROM messages WHERE conversation_id = $1
     ORDER BY created_at ASC`,
    [conversationId]
  );
  return rows;
}

export async function getMessageById(messageId) {
  const { rows } = await pool.query(
    `SELECT id, conversation_id, sender, body, msg_type, quote_data
     FROM messages WHERE id = $1`,
    [messageId]
  );
  return rows[0] || null;
}

export async function insertMessage(conversationId, sender, body) {
  const { rows } = await pool.query(
    `INSERT INTO messages (conversation_id, sender, body)
     VALUES ($1, $2, $3)
     RETURNING id, sender, body, msg_type, quote_data, created_at`,
    [conversationId, sender, body]
  );
  await pool.query(
    `UPDATE conversations SET updated_at = now() WHERE id = $1`,
    [conversationId]
  );
  return rows[0];
}

export async function insertQuoteMessage(conversationId, quoteData) {
  const itemCount = quoteData.items?.length ?? 0;
  const body = `Solicitud de cotización: ${itemCount} producto${itemCount !== 1 ? "s" : ""}`;
  const { rows } = await pool.query(
    `INSERT INTO messages (conversation_id, sender, body, msg_type, quote_data)
     VALUES ($1, 'customer', $2, 'quote_request', $3)
     RETURNING id, sender, body, msg_type, quote_data, created_at`,
    [conversationId, body, JSON.stringify(quoteData)]
  );
  await pool.query(
    `UPDATE conversations SET updated_at = now() WHERE id = $1`,
    [conversationId]
  );
  return rows[0];
}

export async function insertQuoteAcceptedMessage(conversationId, orderNumber) {
  const body = `¡Cotización aceptada! Tu pedido #${orderNumber} fue registrado. Te contactaremos pronto.`;
  const { rows } = await pool.query(
    `INSERT INTO messages (conversation_id, sender, body, msg_type, quote_data)
     VALUES ($1, 'seller', $2, 'quote_accepted', $3)
     RETURNING id, sender, body, msg_type, quote_data, created_at`,
    [conversationId, body, JSON.stringify({ order_number: orderNumber })]
  );
  await pool.query(
    `UPDATE conversations SET updated_at = now() WHERE id = $1`,
    [conversationId]
  );
  return rows[0];
}

export async function markCustomerMessagesRead(conversationId) {
  await pool.query(
    `UPDATE messages SET read_at = now()
     WHERE conversation_id = $1 AND sender = 'customer' AND read_at IS NULL`,
    [conversationId]
  );
}

export async function getConversationsForSeller(sellerId) {
  const { rows } = await pool.query(
    `SELECT
       c.id, c.customer_name, c.customer_email, c.customer_phone, c.updated_at,
       (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
       (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender = 'customer' AND m.read_at IS NULL)::int AS unread_count
     FROM conversations c
     WHERE c.seller_id = $1
     ORDER BY c.updated_at DESC`,
    [sellerId]
  );
  return rows;
}

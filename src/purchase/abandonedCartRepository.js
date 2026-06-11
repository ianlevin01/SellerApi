import pool from "../database/db.js";

export async function saveAbandonedCart({ sellerId, pageId, slug, customer, items, total }) {
  const { rows } = await pool.query(
    `INSERT INTO abandoned_carts
       (seller_id, page_id, slug, status, customer_email, customer_name, customer_phone, customer_doc_type, customer_doc_number, items, total)
     VALUES ($1, $2, $3, 'iniciado', $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      sellerId, pageId, slug,
      customer.email, customer.name,
      customer.phone     || null,
      customer.docType   || null,
      customer.docNumber || null,
      JSON.stringify(items),
      total,
    ]
  );
  return rows[0] ?? null;
}

export async function markAbandonedCartPaidByEmail(sellerId, customerEmail) {
  await pool.query(
    `UPDATE abandoned_carts
     SET status = 'pagado', updated_at = NOW()
     WHERE seller_id = $1 AND customer_email = $2 AND status = 'iniciado'`,
    [sellerId, customerEmail]
  );
}

export async function getAbandonedCartsForPage(pageId) {
  const { rows } = await pool.query(
    `SELECT id, status, customer_email, customer_name, customer_phone,
            customer_doc_type, customer_doc_number, items, total, contacted_at, created_at
     FROM abandoned_carts
     WHERE page_id = $1
     ORDER BY created_at DESC
     LIMIT 200`,
    [pageId]
  );
  return rows;
}

export async function getInitiatedCartsOlderThan(hours) {
  const { rows } = await pool.query(
    `SELECT ac.id, ac.customer_email, ac.customer_name, ac.items, ac.total,
            ac.slug, ac.seller_id,
            sp.store_name, sp.slug AS page_slug
     FROM abandoned_carts ac
     JOIN seller_pages sp ON sp.id = ac.page_id
     WHERE ac.status = 'iniciado'
       AND ac.created_at < NOW() - ($1 || ' hours')::INTERVAL`,
    [String(hours)]
  );
  return rows;
}

export async function markContactado(cartId) {
  await pool.query(
    `UPDATE abandoned_carts
     SET status = 'contactado', contacted_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [cartId]
  );
}

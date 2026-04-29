import pool from "../database/db.js";

// ── CVU ───────────────────────────────────────────────────────

export async function getSellerCvu(sellerId) {
  const { rows } = await pool.query(
    `SELECT cvu, cvu_alias, cvu_holder_name, cvu_verified FROM sellers WHERE id = $1`,
    [sellerId]
  );
  return rows[0] || null;
}

export async function updateSellerCvu(sellerId, { cvu, cvuAlias, cvuHolderName, cvuVerified }) {
  await pool.query(
    `UPDATE sellers
     SET cvu             = $1,
         cvu_alias       = $2,
         cvu_holder_name = $3,
         cvu_verified    = $4
     WHERE id = $5`,
    [cvu, cvuAlias || null, cvuHolderName || null, cvuVerified, sellerId]
  );
}

// ── Ganancias ─────────────────────────────────────────────────

export async function createEarning(sellerId, webOrderId, amount) {
  await pool.query(
    `INSERT INTO seller_earnings (seller_id, web_order_id, amount)
     VALUES ($1, $2, $3)
     ON CONFLICT (web_order_id) DO NOTHING`,
    [sellerId, webOrderId, amount]
  );
}

export async function getEarnings(sellerId, status) {
  const { rows } = await pool.query(
    `SELECT se.id, se.amount, se.status, se.created_at,
            wo.numero AS order_numero, wo.created_at AS order_date, wo.total AS order_total
     FROM seller_earnings se
     JOIN web_orders wo ON wo.id = se.web_order_id
     WHERE se.seller_id = $1 AND se.status = $2
     ORDER BY se.created_at DESC`,
    [sellerId, status]
  );
  return rows;
}

export async function getBalanceSummary(sellerId) {
  const { rows } = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'pending_approval' THEN amount END), 0) AS pending_total,
       COALESCE(SUM(CASE WHEN status = 'available'        THEN amount END), 0) AS available_total
     FROM seller_earnings
     WHERE seller_id = $1`,
    [sellerId]
  );
  return rows[0];
}

export async function approveOrderEarning(webOrderId) {
  const { rowCount } = await pool.query(
    `UPDATE seller_earnings
     SET status = 'available'
     WHERE web_order_id = $1 AND status = 'pending_approval'`,
    [webOrderId]
  );
  return rowCount > 0;
}

// ── Pagos ─────────────────────────────────────────────────────

export async function createPayout(sellerId, amount, cvu) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `INSERT INTO seller_payouts (seller_id, amount, cvu)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [sellerId, amount, cvu]
    );
    const payout = rows[0];

    await client.query(
      `UPDATE seller_earnings
       SET status = 'paid_out', payout_id = $1
       WHERE seller_id = $2 AND status = 'available'`,
      [payout.id, sellerId]
    );

    await client.query("COMMIT");
    return payout;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getPayouts(sellerId) {
  const { rows } = await pool.query(
    `SELECT id, amount, cvu, status, created_at, transferred_at
     FROM seller_payouts
     WHERE seller_id = $1
     ORDER BY created_at DESC`,
    [sellerId]
  );
  return rows;
}

export async function markPayoutTransferred(payoutId) {
  const { rowCount } = await pool.query(
    `UPDATE seller_payouts
     SET status = 'transferido', transferred_at = NOW()
     WHERE id = $1 AND status = 'en_proceso'`,
    [payoutId]
  );
  return rowCount > 0;
}

// ── Helpers para calcular ganancias ──────────────────────────

export async function getOrderForEarning(webOrderId) {
  const { rows } = await pool.query(
    `SELECT wo.id, wo.seller_id, wo.total,
            COALESCE(
              (SELECT json_agg(json_build_object(
                'product_id', woi.product_id,
                'quantity',   woi.quantity,
                'unit_price', woi.unit_price
              )) FROM web_order_items woi WHERE woi.web_order_id = wo.id),
              '[]'
            ) AS items
     FROM web_orders wo
     WHERE wo.id = $1`,
    [webOrderId]
  );
  return rows[0] || null;
}

export async function getCostUsdForProduct(productId) {
  const { rows } = await pool.query(
    `SELECT cost FROM product_costs WHERE product_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [productId]
  );
  return Number(rows[0]?.cost || 0);
}

export async function getCotizacion() {
  const { rows } = await pool.query(`SELECT cotizacion_dolar FROM price_config LIMIT 1`);
  return Number(rows[0]?.cotizacion_dolar || 1);
}

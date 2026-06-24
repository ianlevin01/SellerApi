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

export async function createEarning(sellerId, webOrderId, amount, availableAt) {
  await pool.query(
    `INSERT INTO seller_earnings (seller_id, web_order_id, amount, status, available_at)
     VALUES ($1, $2, $3, 'available', $4)
     ON CONFLICT (web_order_id) DO NOTHING`,
    [sellerId, webOrderId, amount, availableAt]
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
       COALESCE(SUM(CASE WHEN status = 'available' AND available_at > NOW() THEN amount END), 0) AS pending_total,
       COALESCE(SUM(CASE WHEN status = 'available'
                          AND (available_at IS NULL OR available_at <= NOW())
                    THEN amount END), 0) AS available_total
     FROM seller_earnings
     WHERE seller_id = $1`,
    [sellerId]
  );
  return rows[0];
}

export async function getAvailableEarnings(sellerId) {
  const { rows } = await pool.query(
    `SELECT se.id, se.amount, se.status, se.created_at, se.available_at,
            wo.numero AS order_numero, wo.created_at AS order_date, wo.total AS order_total
     FROM seller_earnings se
     JOIN web_orders wo ON wo.id = se.web_order_id
     WHERE se.seller_id = $1 AND se.status = 'available' AND (se.available_at IS NULL OR se.available_at <= NOW())
     ORDER BY se.available_at ASC`,
    [sellerId]
  );
  return rows;
}

export async function getPendingReleaseEarnings(sellerId) {
  const { rows } = await pool.query(
    `SELECT se.id, se.amount, se.status, se.created_at, se.available_at,
            wo.numero AS order_numero, wo.created_at AS order_date, wo.total AS order_total
     FROM seller_earnings se
     JOIN web_orders wo ON wo.id = se.web_order_id
     WHERE se.seller_id = $1 AND se.status = 'available' AND se.available_at > NOW()
     ORDER BY se.available_at ASC`,
    [sellerId]
  );
  return rows;
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
  const { rows } = await pool.query(
    `UPDATE seller_payouts sp
     SET status = 'transferido', transferred_at = NOW()
     FROM sellers s
     WHERE sp.id = $1 AND sp.status = 'en_proceso' AND s.id = sp.seller_id
     RETURNING sp.amount, sp.cvu, s.name AS seller_name, s.email AS seller_email`,
    [payoutId]
  );
  return rows[0] || null;
}

// ── Helpers para calcular ganancias ──────────────────────────

export async function getOrderForEarning(webOrderId) {
  const { rows } = await pool.query(
    `SELECT wo.id, wo.seller_id, wo.total, wo.updated_at, wo.order_type,
            COALESCE(wo.free_shipping_absorbed, 0) AS free_shipping_absorbed,
            COALESCE(
              (SELECT json_agg(json_build_object(
                'product_id',        woi.product_id,
                'quantity',          woi.quantity,
                'unit_price',        woi.unit_price,
                'unit_cost',         woi.unit_cost,
                'seller_stock_used', woi.seller_stock_used
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
    `SELECT costo_usd FROM products WHERE id = $1`,
    [productId]
  );
  return Number(rows[0]?.costo_usd || 0);
}

export async function getCotizacion() {
  const { rows } = await pool.query(
    `SELECT cotizacion_dolar FROM price_config WHERE negocio_id = '00000000-0000-0000-0000-000000000001' LIMIT 1`
  );
  return Number(rows[0]?.cotizacion_dolar || 1);
}

export async function getSellerTotalSales(sellerId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(total), 0) AS total_sales
     FROM web_orders
     WHERE seller_id = $1 AND color = 'paid'`,
    [sellerId]
  );
  return Number(rows[0]?.total_sales || 0);
}

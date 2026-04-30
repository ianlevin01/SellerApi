import pool from "../database/db.js";

// ── Dashboard ────────────────────────────────────────────────

export async function getDashboardStats() {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM sellers WHERE active = true)                                    AS sellers_active,
      (SELECT COUNT(*) FROM sellers)                                                         AS sellers_total,
      (SELECT COUNT(*) FROM sellers WHERE cvu IS NOT NULL AND cvu_verified = false)          AS cvu_pending,
      (SELECT COUNT(*) FROM web_orders WHERE created_at >= now() - interval '1 day')        AS orders_today,
      (SELECT COUNT(*) FROM web_orders)                                                      AS orders_total,
      (SELECT COALESCE(SUM(total),0) FROM web_orders WHERE color = 'paid')                  AS revenue_total,
      (SELECT COUNT(*) FROM seller_earnings WHERE status = 'pending_approval')              AS earnings_pending,
      (SELECT COUNT(*) FROM seller_payouts WHERE status = 'en_proceso')                     AS payouts_pending
  `);
  return rows[0];
}

export async function getRecentOrders(limit = 20) {
  const { rows } = await pool.query(`
    SELECT wo.id, wo.numero, wo.customer_name, wo.total, wo.color, wo.created_at,
           s.name AS seller_name, s.email AS seller_email
    FROM web_orders wo
    JOIN sellers s ON s.id = wo.seller_id
    ORDER BY wo.created_at DESC
    LIMIT $1`, [limit]);
  return rows;
}

export async function getRecentSellers(limit = 10) {
  const { rows } = await pool.query(`
    SELECT id, name, email, city, created_at, active, cvu_verified
    FROM sellers ORDER BY created_at DESC LIMIT $1`, [limit]);
  return rows;
}

// ── Sellers ──────────────────────────────────────────────────

export async function getAllSellers() {
  const { rows } = await pool.query(`
    SELECT
      s.id, s.name, s.email, s.phone, s.city, s.created_at, s.active,
      s.cvu, s.cvu_alias, s.cvu_holder_name, s.cvu_verified,
      COUNT(DISTINCT sp.id)  FILTER (WHERE sp.active = true) AS pages_active,
      COUNT(DISTINCT wo.id)                                  AS orders_total,
      COALESCE(SUM(se.amount) FILTER (WHERE se.status = 'available'), 0) AS balance_available,
      COALESCE(SUM(se.amount) FILTER (WHERE se.status = 'pending_approval'), 0) AS balance_pending
    FROM sellers s
    LEFT JOIN seller_pages sp ON sp.seller_id = s.id
    LEFT JOIN web_orders wo ON wo.seller_id = s.id
    LEFT JOIN seller_earnings se ON se.seller_id = s.id
    GROUP BY s.id
    ORDER BY s.created_at DESC`);
  return rows;
}

export async function getSellerById(id) {
  const { rows } = await pool.query(
    `SELECT s.*,
            COUNT(DISTINCT sp.id) FILTER (WHERE sp.active = true) AS pages_active
     FROM sellers s
     LEFT JOIN seller_pages sp ON sp.seller_id = s.id
     WHERE s.id = $1
     GROUP BY s.id`, [id]);
  return rows[0] || null;
}

export async function getSellerPages(sellerId) {
  const { rows } = await pool.query(
    `SELECT id, page_name, store_name, slug, active, created_at FROM seller_pages WHERE seller_id = $1 ORDER BY id`, [sellerId]);
  return rows;
}

export async function getSellerOrders(sellerId) {
  const { rows } = await pool.query(`
    SELECT wo.id, wo.numero, wo.customer_name, wo.total, wo.color, wo.created_at,
           COALESCE((SELECT json_agg(json_build_object('name',woi.name,'quantity',woi.quantity,'unit_price',woi.unit_price))
             FROM web_order_items woi WHERE woi.web_order_id = wo.id),'[]') AS items
    FROM web_orders wo
    WHERE wo.seller_id = $1
    ORDER BY wo.created_at DESC`, [sellerId]);
  return rows;
}

export async function getSellerEarnings(sellerId) {
  const { rows } = await pool.query(`
    SELECT se.id, se.amount, se.status, se.created_at,
           wo.numero AS order_numero, wo.total AS order_total
    FROM seller_earnings se
    JOIN web_orders wo ON wo.id = se.web_order_id
    WHERE se.seller_id = $1
    ORDER BY se.created_at DESC`, [sellerId]);
  return rows;
}

export async function blockSeller(id, active) {
  const { rows } = await pool.query(
    `UPDATE sellers SET active = $1 WHERE id = $2 RETURNING id, name, email, active`, [active, id]);
  return rows[0];
}

export async function verifyCvu(id, verified) {
  const { rows } = await pool.query(
    `UPDATE sellers SET cvu_verified = $1 WHERE id = $2 RETURNING id, name, cvu, cvu_alias, cvu_verified`, [verified, id]);
  return rows[0];
}

// ── Orders ───────────────────────────────────────────────────

export async function getAllOrders({ sellerId, status, from, to, limit = 100, offset = 0 }) {
  const conditions = [];
  const params     = [];

  if (sellerId) { params.push(sellerId); conditions.push(`wo.seller_id = $${params.length}`); }
  if (status)   { params.push(status);   conditions.push(`wo.color = $${params.length}`); }
  if (from)     { params.push(from);     conditions.push(`wo.created_at >= $${params.length}`); }
  if (to)       { params.push(to);       conditions.push(`wo.created_at <= $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit, offset);

  const { rows } = await pool.query(`
    SELECT wo.id, wo.numero, wo.customer_name, wo.customer_email, wo.customer_city,
           wo.total, wo.shipping_amount, wo.color, wo.created_at, wo.mp_payment_id,
           s.name AS seller_name, s.email AS seller_email,
           COALESCE((SELECT json_agg(json_build_object('name',woi.name,'quantity',woi.quantity,'unit_price',woi.unit_price))
             FROM web_order_items woi WHERE woi.web_order_id = wo.id),'[]') AS items
    FROM web_orders wo
    JOIN sellers s ON s.id = wo.seller_id
    ${where}
    ORDER BY wo.created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return rows;
}

// ── Earnings ─────────────────────────────────────────────────

export async function getAllEarnings(status) {
  const where = status ? `WHERE se.status = $1` : "";
  const params = status ? [status] : [];
  const { rows } = await pool.query(`
    SELECT se.id, se.amount, se.status, se.created_at,
           s.name AS seller_name, s.email AS seller_email,
           wo.numero AS order_numero, wo.total AS order_total, wo.created_at AS order_date
    FROM seller_earnings se
    JOIN sellers s ON s.id = se.seller_id
    JOIN web_orders wo ON wo.id = se.web_order_id
    ${where}
    ORDER BY se.created_at DESC`, params);
  return rows;
}

export async function approveEarning(id) {
  const { rows } = await pool.query(
    `UPDATE seller_earnings SET status = 'available' WHERE id = $1 AND status = 'pending_approval' RETURNING *`, [id]);
  return rows[0];
}

// ── Payouts ──────────────────────────────────────────────────

export async function getAllPayouts(status) {
  const where = status ? `WHERE sp.status = $1` : "";
  const params = status ? [status] : [];
  const { rows } = await pool.query(`
    SELECT sp.id, sp.amount, sp.cvu, sp.status, sp.created_at, sp.transferred_at,
           s.name AS seller_name, s.email AS seller_email,
           s.cvu_alias, s.cvu_holder_name
    FROM seller_payouts sp
    JOIN sellers s ON s.id = sp.seller_id
    ${where}
    ORDER BY sp.created_at DESC`, params);
  return rows;
}

export async function markPayoutTransferred(id) {
  const { rows } = await pool.query(
    `UPDATE seller_payouts SET status = 'transferido', transferred_at = now()
     WHERE id = $1 AND status = 'en_proceso' RETURNING *`, [id]);
  return rows[0];
}

// ── Sales report ─────────────────────────────────────────────

export async function getSalesReport({ from, to, sellerId } = {}) {
  const conds  = ["wo.color = 'paid'"];
  const params = [];

  if (from)     { params.push(from);     conds.push(`wo.created_at >= $${params.length}`); }
  if (to)       { params.push(to);       conds.push(`wo.created_at <  $${params.length} + interval '1 day'`); }
  if (sellerId) { params.push(sellerId); conds.push(`wo.seller_id = $${params.length}`); }

  const where = `WHERE ${conds.join(" AND ")}`;

  const { rows: [summary] } = await pool.query(`
    SELECT
      COUNT(wo.id)::int            AS total_orders,
      COALESCE(SUM(wo.total), 0)   AS total_revenue,
      COALESCE(AVG(wo.total), 0)   AS avg_ticket,
      COALESCE(SUM(se.amount), 0)  AS total_earnings
    FROM web_orders wo
    JOIN sellers s ON s.id = wo.seller_id
    LEFT JOIN seller_earnings se ON se.web_order_id = wo.id
    ${where}`, params);

  const { rows: bySeller } = await pool.query(`
    SELECT s.id, s.name AS seller_name, s.email AS seller_email,
           COUNT(wo.id)::int            AS order_count,
           COALESCE(SUM(wo.total), 0)   AS revenue,
           COALESCE(SUM(se.amount), 0)  AS earnings
    FROM web_orders wo
    JOIN sellers s ON s.id = wo.seller_id
    LEFT JOIN seller_earnings se ON se.web_order_id = wo.id
    ${where}
    GROUP BY s.id, s.name, s.email
    ORDER BY revenue DESC`, params);

  return { summary, by_seller: bySeller };
}

// ── Catalog ──────────────────────────────────────────────────

export async function getAllProducts() {
  const { rows } = await pool.query(`
    SELECT p.id, p.code, p.name, p.active,
           c.name AS category_name,
           (SELECT pc.cost FROM product_costs pc WHERE pc.product_id = p.id ORDER BY pc.created_at DESC LIMIT 1) AS cost_usd,
           COALESCE((SELECT s.quantity FROM stock s WHERE s.product_id = p.id LIMIT 1), 0) AS stock
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    ORDER BY p.name`);
  return rows;
}

export async function updateProductCost(productId, cost) {
  await pool.query(
    `INSERT INTO product_costs (product_id, cost) VALUES ($1, $2)`, [productId, cost]);
}

export async function getPriceConfig() {
  const { rows } = await pool.query(
    `SELECT cotizacion_dolar FROM price_config WHERE negocio_id = '00000000-0000-0000-0000-000000000001' LIMIT 1`);
  return rows[0] || null;
}

export async function updatePriceConfig(cotizacion) {
  await pool.query(
    `UPDATE price_config SET cotizacion_dolar = $1 WHERE negocio_id = '00000000-0000-0000-0000-000000000001'`, [cotizacion]);
}

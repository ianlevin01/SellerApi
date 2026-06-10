import pool from "../database/db.js";
import { NEGOCIOS_ACTIVOS } from "../config/negociosConfig.js";

const NEGOCIOS_SQL = `ARRAY[${NEGOCIOS_ACTIVOS.map(id => `'${id}'`).join(",")}]::uuid[]`;

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

export async function getMetrics() {
  const ART = "America/Argentina/Buenos_Aires";

  const { rows: [summary] } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM sellers)::int                                              AS total_sellers,
      (SELECT COUNT(DISTINCT seller_id) FROM seller_pages)::int                        AS sellers_with_store,
      (SELECT COUNT(DISTINCT sp.seller_id)
       FROM seller_pages sp
       WHERE EXISTS (SELECT 1 FROM seller_products spr WHERE spr.page_id = sp.id))::int AS sellers_with_products,
      (SELECT COUNT(DISTINCT seller_id) FROM web_orders WHERE color = 'paid')::int     AS sellers_with_sales,

      (SELECT COUNT(*) FROM sellers WHERE cvu_verified = true)::int                    AS cvu_verified,
      (SELECT COUNT(*) FROM sellers WHERE cvu IS NOT NULL AND cvu_verified = false)::int AS cvu_pending,
      (SELECT COUNT(*) FROM sellers WHERE cvu IS NULL)::int                            AS cvu_none,

      (SELECT COUNT(*) FROM sellers WHERE plan_status = 'trial')::int                  AS plan_trial,
      (SELECT COUNT(*) FROM sellers WHERE plan_status = 'active')::int                 AS plan_active,
      (SELECT COUNT(*) FROM sellers
       WHERE plan_status = 'expired' OR (plan_status IS NULL AND trial_ends_at < NOW()))::int AS plan_expired,

      (SELECT COUNT(*) FROM sellers WHERE last_active_at >= NOW() - INTERVAL '1 day')::int  AS active_1d,
      (SELECT COUNT(*) FROM sellers WHERE last_active_at >= NOW() - INTERVAL '3 days')::int AS active_3d,
      (SELECT COUNT(*) FROM sellers WHERE last_active_at >= NOW() - INTERVAL '7 days')::int AS active_7d,
      (SELECT COUNT(*) FROM sellers WHERE last_active_at >= NOW() - INTERVAL '14 days')::int AS active_14d,
      (SELECT COUNT(*) FROM sellers WHERE last_active_at >= NOW() - INTERVAL '30 days')::int AS active_30d,

      (SELECT COUNT(*) FROM sellers WHERE created_at >= NOW() - INTERVAL '7 days')::int  AS new_7d,
      (SELECT COUNT(*) FROM sellers WHERE created_at >= NOW() - INTERVAL '30 days')::int AS new_30d,

      (SELECT COUNT(*) FROM web_orders WHERE color = 'paid')::int                          AS total_orders_paid,
      (SELECT COALESCE(SUM(total),0) FROM web_orders WHERE color = 'paid')::numeric        AS total_revenue,
      (SELECT COUNT(*) FROM web_orders WHERE color = 'paid'
       AND created_at >= NOW() - INTERVAL '30 days')::int                                  AS orders_30d,
      (SELECT COALESCE(SUM(total),0) FROM web_orders WHERE color = 'paid'
       AND created_at >= NOW() - INTERVAL '30 days')::numeric                              AS revenue_30d,

      (SELECT COUNT(*) FROM seller_pages WHERE active = true)::int                         AS active_stores
  `);

  const { rows: dailySignups } = await pool.query(`
    SELECT
      (created_at AT TIME ZONE $1)::date::text AS date,
      COUNT(*)::int AS count
    FROM sellers
    WHERE created_at >= NOW() - INTERVAL '45 days'
    GROUP BY (created_at AT TIME ZONE $1)::date
    ORDER BY 1
  `, [ART]);

  const { rows: dailyOrders } = await pool.query(`
    SELECT
      (created_at AT TIME ZONE $1)::date::text AS date,
      COUNT(*)::int AS count,
      COALESCE(SUM(total), 0)::numeric AS revenue
    FROM web_orders
    WHERE color = 'paid' AND created_at >= NOW() - INTERVAL '45 days'
    GROUP BY (created_at AT TIME ZONE $1)::date
    ORDER BY 1
  `, [ART]);

  const { rows: topStoresAllTime } = await pool.query(`
    SELECT
      sp.store_name, sp.slug, s.name AS seller_name,
      SUM(sad.visits)::int AS total_visits
    FROM store_analytics_daily sad
    JOIN seller_pages sp ON sp.id = sad.page_id
    JOIN sellers s ON s.id = sp.seller_id
    GROUP BY sp.id, sp.store_name, sp.slug, s.name
    ORDER BY total_visits DESC
    LIMIT 10
  `);

  const { rows: topStoresToday } = await pool.query(`
    SELECT
      sp.store_name, sp.slug, s.name AS seller_name,
      COALESCE(sad.visits, 0)::int AS visits_today
    FROM seller_pages sp
    JOIN sellers s ON s.id = sp.seller_id
    LEFT JOIN store_analytics_daily sad
      ON sad.page_id = sp.id
      AND sad.date = (NOW() AT TIME ZONE $1)::date
    WHERE sp.active = true AND COALESCE(sad.visits, 0) > 0
    ORDER BY visits_today DESC
    LIMIT 10
  `, [ART]);

  return {
    summary,
    daily_signups:       dailySignups,
    daily_orders:        dailyOrders,
    top_stores_all_time: topStoresAllTime,
    top_stores_today:    topStoresToday,
  };
}

// ── Sellers ──────────────────────────────────────────────────

export async function getAllSellers() {
  const { rows } = await pool.query(`
    SELECT
      s.id, s.name, s.email, s.phone, s.city, s.created_at, s.active,
      s.plan_id, s.plan_status, s.trial_ends_at, s.last_active_at,
      s.cvu, s.cvu_alias, s.cvu_holder_name, s.cvu_verified,
      COUNT(DISTINCT sp.id)  FILTER (WHERE sp.active = true) AS pages_active,
      COUNT(DISTINCT wo.id)                                  AS orders_total,
      COALESCE(SUM(se.amount) FILTER (WHERE se.status = 'available'), 0) AS balance_available,
      COALESCE(SUM(se.amount) FILTER (WHERE se.status = 'pending_approval'), 0) AS balance_pending,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT sp.store_name), NULL) AS store_names
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
           COALESCE((SELECT json_agg(json_build_object('name',woi.name,'quantity',woi.quantity,'unit_price',woi.unit_price,'selected_color_name',woi.selected_color_name,'selected_color_hex',woi.selected_color_hex))
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
    `UPDATE sellers SET cvu_verified = $1 WHERE id = $2 RETURNING id, name, email, cvu, cvu_alias, cvu_holder_name, cvu_verified`, [verified, id]);
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
    SELECT wo.id, wo.numero, wo.customer_name, wo.customer_email, wo.customer_phone,
           wo.customer_city, wo.observaciones,
           wo.total, wo.shipping_amount, wo.color, wo.created_at, wo.mp_payment_id,
           s.name AS seller_name, s.email AS seller_email,
           COALESCE((SELECT json_agg(json_build_object('name',woi.name,'quantity',woi.quantity,'unit_price',woi.unit_price,'selected_color_name',woi.selected_color_name,'selected_color_hex',woi.selected_color_hex))
             FROM web_order_items woi WHERE woi.web_order_id = wo.id),'[]') AS items,
           (SELECT row_to_json(os) FROM order_shipping os WHERE os.web_order_id = wo.id LIMIT 1) AS shipping
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
    `UPDATE seller_payouts sp
     SET status = 'transferido', transferred_at = now()
     FROM sellers s
     WHERE sp.id = $1 AND sp.status = 'en_proceso' AND s.id = sp.seller_id
     RETURNING sp.amount, sp.cvu, s.name AS seller_name, s.email AS seller_email`,
    [id]
  );
  return rows[0] || null;
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

// ── Order status transitions ─────────────────────────────────

export async function markOrderPackaged(orderId) {
  const { rows } = await pool.query(`
    WITH updated AS (
      UPDATE web_orders SET color = 'packaged'
      WHERE id = $1 AND color = 'paid'
      RETURNING id, numero, customer_name, customer_email, total, shipping_amount
    )
    SELECT u.*,
      COALESCE(
        (SELECT json_agg(json_build_object('name', woi.name, 'quantity', woi.quantity, 'unit_price', woi.unit_price))
         FROM web_order_items woi WHERE woi.web_order_id = u.id),
        '[]'
      ) AS items
    FROM updated u
  `, [orderId]);
  return rows[0] || null;
}

export async function getPackagedOrdersWithShipping() {
  const { rows } = await pool.query(`
    SELECT wo.id, wo.numero, wo.customer_name, wo.customer_email,
           wo.total, wo.shipping_amount, os.shipping_type
    FROM web_orders wo
    JOIN order_shipping os ON os.web_order_id = wo.id
    WHERE wo.color = 'packaged'
      AND os.shipping_type IN ('home', 'branch')
  `);
  return rows;
}

export async function markOrderShippedDirect(orderId, trackingCode) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE web_orders SET color = 'shipped'
       WHERE id = $1 AND color IN ('paid', 'packaged')
       RETURNING id, numero, customer_name, customer_email`,
      [orderId]
    );
    if (rows[0] && trackingCode) {
      const upd = await client.query(
        `UPDATE order_shipping SET tracking_code = $1 WHERE web_order_id = $2`,
        [trackingCode, orderId]
      );
      if (upd.rowCount === 0) {
        await client.query(
          `INSERT INTO order_shipping (web_order_id, shipping_type, tracking_code) VALUES ($1, 'other', $2)`,
          [orderId, trackingCode]
        );
      }
    }
    await client.query("COMMIT");
    return rows[0] || null;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function markOrderShipped(orderId, trackingNumber) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE web_orders SET color = 'shipped'
       WHERE id = $1 AND color = 'packaged'
       RETURNING id, numero, customer_name, customer_email`,
      [orderId]
    );
    if (rows[0] && trackingNumber) {
      await client.query(
        `UPDATE order_shipping SET tracking_code = $1 WHERE web_order_id = $2`,
        [trackingNumber, orderId]
      );
    }
    await client.query("COMMIT");
    return rows[0] || null;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ── Catalog ──────────────────────────────────────────────────

export async function getAllProducts() {
  const { rows } = await pool.query(`
    SELECT p.id, p.code, p.name, p.active,
           c.name AS category_name,
           p.costo_usd AS cost_usd,
           p.weight_grams, p.volume_cm3, p.dims_reviewed,
           COALESCE((SELECT s.quantity FROM stock s WHERE s.product_id = p.id LIMIT 1), 0) AS stock
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.negocio_id = ANY(${NEGOCIOS_SQL})
    ORDER BY p.name`);
  return rows;
}

export async function updateProductDimensions(productId, { weight_grams, volume_cm3, dims_reviewed }) {
  const sets   = [];
  const params = [];

  if (weight_grams  !== undefined) { params.push(weight_grams);  sets.push(`weight_grams = $${params.length}`); }
  if (volume_cm3    !== undefined) { params.push(volume_cm3);    sets.push(`volume_cm3 = $${params.length}`); }
  if (dims_reviewed !== undefined) { params.push(dims_reviewed); sets.push(`dims_reviewed = $${params.length}`); }

  if (!sets.length) return;
  params.push(productId);
  await pool.query(`UPDATE products SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
}

export async function updateProductCost(productId, cost) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE products SET costo_usd = $1 WHERE id = $2`, [cost, productId]);
    await client.query(`INSERT INTO product_costs (product_id, cost) VALUES ($1, $2)`, [productId, cost]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
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

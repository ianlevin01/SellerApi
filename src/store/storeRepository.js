// src/modules/store/storeRepository.j
import pool from "../database/db.js"
// ── Cotización ────────────────────────────────────────────────

export async function getCotizacion() {
  const { rows } = await pool.query(`SELECT cotizacion_dolar FROM price_config LIMIT 1`);
  return Number(rows[0]?.cotizacion_dolar || 1);
}

// ── Config ────────────────────────────────────────────────────

export async function getConfig(sellerId) {
  const { rows } = await pool.query(
    `SELECT * FROM seller_pages WHERE seller_id = $1`,
    [sellerId]
  );
  return rows[0] || null;
}

export async function updateConfig(sellerId, { store_name, store_description, banner_color, pct_markup }) {
  const { rows } = await pool.query(
    `UPDATE seller_pages
     SET store_name        = COALESCE($1, store_name),
         store_description = COALESCE($2, store_description),
         banner_color      = COALESCE($3, banner_color),
         pct_markup        = COALESCE($4, pct_markup),
         updated_at        = now()
     WHERE seller_id = $5
     RETURNING *`,
    [store_name, store_description, banner_color, pct_markup, sellerId]
  );
  return rows[0];
}

// ── Pedidos ───────────────────────────────────────────────────

export async function getOrders(sellerId) {
  const { rows } = await pool.query(
    `SELECT
       wo.id, wo.numero, wo.customer_name, wo.customer_email,
       wo.customer_city, wo.total, wo.color, wo.created_at, wo.order_id,
       COALESCE(
         (SELECT json_agg(json_build_object(
           'name',       woi.name,
           'quantity',   woi.quantity,
           'unit_price', woi.unit_price,
           'product_id', woi.product_id
         )) FROM web_order_items woi WHERE woi.web_order_id = wo.id),
         '[]'
       ) AS items
     FROM web_orders wo
     WHERE wo.seller_id = $1
     ORDER BY wo.created_at DESC`,
    [sellerId]
  );
  return rows;
}

export async function getPrecio1ForProduct(productId) {
  const { rows } = await pool.query(
    `SELECT price FROM product_prices
     WHERE product_id = $1 AND price_type = 'precio_1' LIMIT 1`,
    [productId]
  );
  return Number(rows[0]?.price || 0);
}

// ── Tienda pública ────────────────────────────────────────────

export async function getPageBySlug(slug) {
  const { rows } = await pool.query(
    `SELECT sp.*, s.name AS seller_name
     FROM seller_pages sp
     JOIN sellers s ON s.id = sp.seller_id
     WHERE sp.slug = $1 AND sp.active = true`,
    [slug]
  );
  return rows[0] || null;
}

export async function getPublicProducts(sellerId) {
  const { rows } = await pool.query(
    `SELECT
       p.id, p.code, p.name, p.description,
       (SELECT pp.price FROM product_prices pp
        WHERE pp.product_id = p.id AND pp.price_type = 'precio_1' LIMIT 1) AS precio_1,
       COALESCE(
         (SELECT json_agg(si.key ORDER BY si."order")
          FROM seller_images si WHERE si.seller_id = $1 AND si.product_id = p.id),
         (SELECT json_agg(pi.key ORDER BY pi.created_at)
          FROM product_images pi WHERE pi.product_id = p.id),
         '[]'
       ) AS images,
       spc.custom_name,
       spc.custom_desc
     FROM seller_products spc
     JOIN products p ON p.id = spc.product_id
     WHERE spc.seller_id = $1 AND spc.active = true AND p.active = true
     ORDER BY p.name`,
    [sellerId]
  );
  return rows;
}

export async function createPublicOrder({ customer, total, seller_id }) {
  const { rows } = await pool.query(
    `INSERT INTO web_orders
       (customer_name, customer_email, customer_phone, customer_city, observaciones, total, seller_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, numero`,
    [
      customer.name,
      customer.email || null,
      customer.phone || null,
      customer.city  || null,
      customer.notes || null,
      total,
      seller_id,
    ]
  );
  return rows[0];
}

export async function createOrderItems(webOrderId, items) {
  for (const item of items) {
    await pool.query(
      `INSERT INTO web_order_items (web_order_id, product_id, name, quantity, unit_price)
       VALUES ($1, $2, $3, $4, $5)`,
      [webOrderId, item.product_id || null, item.name, item.quantity, item.unit_price]
    );
  }
}

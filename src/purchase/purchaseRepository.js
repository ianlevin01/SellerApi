// src/modules/checkout/checkoutRepository.js
import pool from "../database/db.js";

// ─── Página del revendedor ───────────────────────────────────────────────────

export async function getPageBySlug(slug) {
  const { rows } = await pool.query(
    `SELECT * FROM seller_pages WHERE slug = $1`,
    [slug]
  );
  return rows[0] ?? null;
}

// ─── Cotización del dólar ────────────────────────────────────────────────────

export async function getCotizacionDolar() {
  const NEGOCIO_SISTEMA = "00000000-0000-0000-0000-000000000001";
  const { rows } = await pool.query(
    `SELECT cotizacion_dolar FROM price_config WHERE negocio_id = $1`,
    [NEGOCIO_SISTEMA]
  );
  if (!rows[0]) throw new Error("No se encontró configuración de precio (cotización)");
  return Number(rows[0].cotizacion_dolar);
}

// ─── Productos ───────────────────────────────────────────────────────────────

export async function getProductsByIds(ids, pageId) {
  const { rows } = await pool.query(
    `SELECT
       p.id, p.name,
       p.costo_usd,
       sp.custom_price,
       COALESCE(sp.free_shipping, false) AS free_shipping
     FROM products p
     JOIN seller_products sp ON sp.product_id = p.id
     WHERE p.id = ANY($1) AND sp.page_id = $2`,
    [ids, pageId]
  );
  return rows;
}

export async function getCombosByIds(ids, pageId) {
  if (!ids.length) return [];
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.custom_price, c.free_shipping,
            COALESCE((
              SELECT SUM(p2.costo_usd * cp.quantity)
              FROM combo_products cp
              JOIN products p2 ON p2.id = cp.product_id
              WHERE cp.combo_id = c.id
            ), 0) AS total_cost_usd
     FROM page_combos c
     WHERE c.id = ANY($1) AND c.page_id = $2 AND c.active = true`,
    [ids, pageId]
  );
  return rows;
}

// ─── Descuentos del revendedor ───────────────────────────────────────────────

export async function getSellerDiscountConfig(pageId) {
  const { rows } = await pool.query(
    `SELECT * FROM seller_discounts WHERE page_id = $1`,
    [pageId]
  );
  return rows[0] ?? null;
}

export async function getSellerDiscountTiers(pageId) {
  const { rows } = await pool.query(
    `SELECT * FROM seller_discount_tiers WHERE page_id = $1 ORDER BY threshold ASC`,
    [pageId]
  );
  return rows;
}

// ─── Crear orden ─────────────────────────────────────────────────────────────

export async function createWebOrder({ customer, items, total, seller_id, shipping_amount = 0, free_shipping_absorbed = 0, order_type = null }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Calcular el próximo número de orden para este vendedor (correlativo por vendedor)
    const { rows: numRows } = await client.query(
      `SELECT COALESCE(MAX(numero), 0) + 1 AS next_num FROM web_orders WHERE seller_id = $1`,
      [seller_id]
    );
    const nextNumero = numRows[0].next_num;

    const { rows } = await client.query(
      `
      INSERT INTO web_orders
        (numero, customer_name, customer_email, customer_phone, customer_city, observaciones, total, seller_id, shipping_amount, free_shipping_absorbed, order_type)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
      `,
      [
        nextNumero,
        customer.name,
        customer.email,
        customer.phone  ?? null,
        customer.city   ?? null,
        customer.notes  ?? null,
        total,
        seller_id,
        shipping_amount,
        free_shipping_absorbed,
        order_type,
      ]
    );

    const order = rows[0];

    for (const item of items) {
      await client.query(
        `
        INSERT INTO web_order_items
          (web_order_id, product_id, name, quantity, unit_price, unit_cost, selected_color_name, selected_color_hex)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          order.id,
          item.product_id,
          item.name,
          item.quantity,
          item.unit_price_final,
          item.unit_price_base          ?? null,
          item.selected_color_name      ?? null,
          item.selected_color_hex       ?? null,
        ]
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


export async function getSellerTotalSales(sellerId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(total), 0) AS total FROM web_orders WHERE seller_id = $1`,
    [sellerId]
  );
  return Number(rows[0]?.total || 0);
}

// Returns true if the row was actually updated (false = already in a later state, guard blocked it).
export async function updateOrderStatus(orderId, status, mpPaymentId) {
  // Guard: payment.updated webhooks arrive for already-fulfilled orders (packaged/shipped).
  // Only allow MP status transitions on pre-fulfillment states; refunds always apply.
  const { rowCount } = await pool.query(
    `UPDATE web_orders
     SET color         = $1,
         mp_payment_id = COALESCE($2, mp_payment_id)
     WHERE id = $3
       AND (
         $1 = 'refunded'
         OR color IN ('pending', 'paid')
       )`,
    [status, mpPaymentId, orderId]
  );
  return rowCount > 0;
}

export async function getOrderBasic(orderId) {
  const { rows } = await pool.query(
    `SELECT seller_id, customer_email FROM web_orders WHERE id = $1`,
    [orderId]
  );
  return rows[0] ?? null;
}

export async function getOrderItems(orderId) {
  const { rows } = await pool.query(
    `SELECT product_id, quantity, unit_price
     FROM web_order_items
     WHERE web_order_id = $1`,
    [orderId]
  );
  return rows;
}

export async function getOrderBasicWithType(orderId) {
  const { rows } = await pool.query(
    `SELECT id, seller_id, customer_email, order_type FROM web_orders WHERE id = $1`,
    [orderId]
  );
  return rows[0] ?? null;
}

// Decrementa atómicamente min(reserva_disponible, wantedQty) unidades del stock propio del vendedor.
// Devuelve cuántas unidades se descontaron (0 si no había reserva).
export async function tryUseSellerStock(sellerId, productId, wantedQty) {
  const { rows } = await pool.query(`
    WITH deduction AS (
      SELECT LEAST(quantity, $3::integer) AS to_use
      FROM seller_stock_reserves
      WHERE seller_id = $1 AND product_id = $2 AND quantity > 0
    )
    UPDATE seller_stock_reserves
    SET quantity   = quantity - (SELECT to_use FROM deduction),
        updated_at = NOW()
    WHERE seller_id = $1 AND product_id = $2
      AND EXISTS (SELECT 1 FROM deduction WHERE to_use > 0)
    RETURNING (SELECT to_use FROM deduction) AS used_qty
  `, [sellerId, productId, wantedQty]);
  return Number(rows[0]?.used_qty || 0);
}

export async function markItemSellerStock(webOrderId, productId, usedQty) {
  await pool.query(
    `UPDATE web_order_items
     SET seller_stock_used = $1
     WHERE web_order_id = $2 AND product_id = $3`,
    [usedQty, webOrderId, productId]
  );
}

// Suma qty a la reserva del vendedor para ese producto (crea la fila si no existe).
export async function upsertSellerStockReserve(sellerId, productId, qty) {
  await pool.query(`
    INSERT INTO seller_stock_reserves (seller_id, product_id, quantity)
    VALUES ($1, $2, $3)
    ON CONFLICT (seller_id, product_id)
    DO UPDATE SET quantity   = seller_stock_reserves.quantity + $3,
                  updated_at = NOW()
  `, [sellerId, productId, qty]);
}
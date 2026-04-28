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
       (SELECT pc.cost FROM product_costs pc
        WHERE pc.product_id = p.id ORDER BY pc.created_at DESC LIMIT 1) AS costo_usd,
       sp.custom_price
     FROM products p
     JOIN seller_products sp ON sp.product_id = p.id
     WHERE p.id = ANY($1) AND sp.page_id = $2`,
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

export async function createWebOrder({ customer, items, total, seller_id, shipping_amount = 0 }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `
      INSERT INTO web_orders
        (customer_name, customer_email, customer_phone, customer_city, observaciones, total, seller_id, shipping_amount)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
      `,
      [
        customer.name,
        customer.email,
        customer.phone  ?? null,
        customer.city   ?? null,
        customer.notes  ?? null,
        total,
        seller_id,
        shipping_amount,
      ]
    );

    const order = rows[0];

    for (const item of items) {
      await client.query(
        `
        INSERT INTO web_order_items
          (web_order_id, product_id, name, quantity, unit_price)
        VALUES ($1, $2, $3, $4, $5)
        `,
        [
          order.id,
          item.product_id,
          item.name,
          item.quantity,
          item.unit_price_final,
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


export async function updateOrderStatus(orderId, status, mpPaymentId) {
  await pool.query(
    `UPDATE web_orders SET color = $1, mp_payment_id = $2 WHERE id = $3`,
    [status, mpPaymentId, orderId]
  );
}
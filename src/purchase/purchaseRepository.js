// src/modules/checkout/checkoutRepository.js
import pool from "../database/db.js";

async function getPageBySlug(slug) {
  const { rows } = await db.query(
    `SELECT * FROM seller_pages WHERE slug = $1`,
    [slug]
  );
  return rows[0];
}

async function getProductsByIds(ids, pageId) {
  const { rows } = await db.query(
    `
    SELECT p.id, p.name, pp.price
    FROM products p
    JOIN seller_products sp ON sp.product_id = p.id
    JOIN product_prices pp ON pp.product_id = p.id AND pp.price_type = 'precio_1'
    WHERE p.id = ANY($1) AND sp.page_id = $2
    `,
    [ids, pageId]
  );
  return rows;
}

async function createWebOrder({ customer, items, total, seller_id, negocio_id }) {
  const { rows } = await db.query(
    `
    INSERT INTO web_orders (customer_name, customer_email, customer_phone, customer_city, total, seller_id, negocio_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING *
    `,
    [
      customer.name,
      customer.email,
      customer.phone,
      customer.city,
      total,
      seller_id,
      negocio_id,
    ]
  );

  const order = rows[0];

  for (const item of items) {
    await db.query(
      `
      INSERT INTO web_order_items (web_order_id, product_id, name, quantity, unit_price)
      VALUES ($1,$2,$3,$4,$5)
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

  return order;
}

module.exports = {
  getPageBySlug,
  getProductsByIds,
  getSellerDiscountConfig,
  getSellerDiscountTiers,
  createWebOrder,
};

export async function registerCommission(sellerId, amount) {
  // ejemplo simple: 10%
  const commission = amount * 0.1;

  await pool.query(`
    UPDATE sellers
    SET balance = balance + $1
    WHERE id = $2
  `, [commission, sellerId]);
}

async function getSellerDiscountConfig(pageId) {
  const { rows } = await db.query(
    `SELECT * FROM seller_discounts WHERE page_id = $1`,
    [pageId]
  );
  return rows[0];
}

async function getSellerDiscountTiers(pageId) {
  const { rows } = await db.query(
    `SELECT * FROM seller_discount_tiers WHERE page_id = $1`,
    [pageId]
  );
  return rows;
}
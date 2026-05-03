// src/modules/products/productsRepository.js
import pool from "../database/db.js"

export async function findAll({ pageId, sellerId, search, categoryId, onlyMine, limit = 20, offset = 0 }) {
  let query = `
    SELECT
      p.id, p.code, p.name, p.description, p.active,
      p.category_id, c.name AS category_name,
      (SELECT pc.cost FROM product_costs pc
       WHERE pc.product_id = p.id
       ORDER BY pc.created_at DESC LIMIT 1) AS costo_usd,
      COALESCE(
        (SELECT SUM(s.quantity) FROM stock s WHERE s.product_id = p.id), 0
      ) AS stock_total,
      GREATEST(0, COALESCE(
        (SELECT SUM(s.quantity) FROM stock s WHERE s.product_id = p.id), 0
      ) - COALESCE(p.stock_reserva, 0)) AS available_stock,
      (SELECT sp.id FROM seller_products sp
       WHERE ($1::uuid IS NULL OR sp.page_id = $1) AND sp.seller_id = $2 AND sp.product_id = p.id LIMIT 1) AS seller_product_id,
      (SELECT sp.active FROM seller_products sp
       WHERE ($1::uuid IS NULL OR sp.page_id = $1) AND sp.seller_id = $2 AND sp.product_id = p.id LIMIT 1) AS in_my_store,
      (SELECT sp.custom_name FROM seller_products sp
       WHERE ($1::uuid IS NULL OR sp.page_id = $1) AND sp.seller_id = $2 AND sp.product_id = p.id LIMIT 1) AS custom_name,
      (SELECT sp.custom_desc FROM seller_products sp
       WHERE ($1::uuid IS NULL OR sp.page_id = $1) AND sp.seller_id = $2 AND sp.product_id = p.id LIMIT 1) AS custom_desc,
      (SELECT sp.custom_price FROM seller_products sp
       WHERE ($1::uuid IS NULL OR sp.page_id = $1) AND sp.seller_id = $2 AND sp.product_id = p.id LIMIT 1) AS custom_price,
      COALESCE(
        (SELECT json_agg(pi.key ORDER BY pi.created_at)
         FROM product_images pi WHERE pi.product_id = p.id), '[]'
      ) AS system_images,
      COALESCE(
        (SELECT json_agg(si.key ORDER BY si."order")
         FROM seller_images si
         WHERE si.seller_id = $2 AND si.product_id = p.id
           AND ($1::uuid IS NULL OR si.page_id = $1)
           AND ($1::uuid IS NOT NULL OR si.page_id IS NULL)), '[]'
      ) AS seller_images
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.active = true
  `;

  const params = [pageId, sellerId];
  let idx = 3;

  if (search) {
    query += ` AND (p.name ILIKE $${idx} OR p.code ILIKE $${idx})`;
    params.push(`%${search}%`);
    idx++;
  }
  if (categoryId) {
    query += ` AND p.category_id = $${idx}`;
    params.push(categoryId);
    idx++;
  }
  if (onlyMine) {
    query += ` AND EXISTS (
      SELECT 1 FROM seller_products sp2
      WHERE ($1::uuid IS NULL OR sp2.page_id = $1) AND sp2.seller_id = $2 AND sp2.product_id = p.id AND sp2.active = true
    )`;
  }

  const countQuery = `SELECT COUNT(*) FROM (${query}) AS sub`;
  const { rows: countRows } = await pool.query(countQuery, params);
  const total = Number(countRows[0].count);

  query += ` ORDER BY p.name LIMIT $${idx} OFFSET $${idx + 1}`;
  params.push(limit, offset);

  const { rows } = await pool.query(query, params);
  return { rows, total };
}

export async function addProduct(pageId, sellerId, productId) {
  await pool.query(
    `INSERT INTO seller_products (seller_id, page_id, product_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (page_id, product_id) DO UPDATE SET active = true`,
    [sellerId, pageId, productId]
  );
}

export async function addAllProducts(pageId, sellerId) {
  await pool.query(
    `INSERT INTO seller_products (seller_id, page_id, product_id)
     SELECT $1, $2, p.id FROM products p WHERE p.active = true
     ON CONFLICT (page_id, product_id) DO UPDATE SET active = true`,
    [sellerId, pageId]
  );
}

export async function removeProduct(pageId, productId) {
  await pool.query(
    `UPDATE seller_products SET active = false
     WHERE page_id = $1 AND product_id = $2`,
    [pageId, productId]
  );
}

export async function customizeProduct(pageId, sellerId, productId, { custom_name, custom_desc }) {
  await pool.query(
    `UPDATE seller_products
     SET custom_name = $1, custom_desc = $2
     WHERE page_id = $3 AND seller_id = $4 AND product_id = $5`,
    [custom_name ?? null, custom_desc ?? null, pageId, sellerId, productId]
  );
}

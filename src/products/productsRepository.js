// src/modules/products/productsRepository.js
import pool from "../database/db.js"

export async function findAll({ pageId, sellerId, search, categoryId, onlyMine, notMine, limit = 20, offset = 0 }) {
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
       WHERE ($1::uuid IS NULL OR sp.page_id = $1) AND sp.seller_id = $2 AND sp.product_id = p.id AND sp.active = true LIMIT 1) AS seller_product_id,
      (SELECT sp.active FROM seller_products sp
       WHERE ($1::uuid IS NULL OR sp.page_id = $1) AND sp.seller_id = $2 AND sp.product_id = p.id AND sp.active = true LIMIT 1) AS in_my_store,
      (SELECT sp.custom_name FROM seller_products sp
       WHERE ($1::uuid IS NULL OR sp.page_id = $1) AND sp.seller_id = $2 AND sp.product_id = p.id LIMIT 1) AS custom_name,
      (SELECT sp.custom_desc FROM seller_products sp
       WHERE ($1::uuid IS NULL OR sp.page_id = $1) AND sp.seller_id = $2 AND sp.product_id = p.id LIMIT 1) AS custom_desc,
      (SELECT sp.custom_price FROM seller_products sp
       WHERE ($1::uuid IS NULL OR sp.page_id = $1) AND sp.seller_id = $2 AND sp.product_id = p.id LIMIT 1) AS custom_price,
      COALESCE((SELECT sp.free_shipping FROM seller_products sp
       WHERE ($1::uuid IS NULL OR sp.page_id = $1) AND sp.seller_id = $2 AND sp.product_id = p.id LIMIT 1), false) AS free_shipping,
      (SELECT sp.promo_price FROM seller_products sp
       WHERE ($1::uuid IS NULL OR sp.page_id = $1) AND sp.seller_id = $2 AND sp.product_id = p.id LIMIT 1) AS promo_price,
      COALESCE((SELECT sp.promo_enabled FROM seller_products sp
       WHERE ($1::uuid IS NULL OR sp.page_id = $1) AND sp.seller_id = $2 AND sp.product_id = p.id LIMIT 1), false) AS promo_enabled,
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
      ) AS seller_images,
      CASE
        WHEN (
          COALESCE((SELECT pc2.cost FROM product_costs pc2 WHERE pc2.product_id = p.id ORDER BY pc2.created_at DESC LIMIT 1), 0)
          * COALESCE((SELECT cfg.cotizacion_dolar FROM price_config cfg WHERE cfg.negocio_id = '00000000-0000-0000-0000-000000000001' LIMIT 1), 0)
          * 1.56
        ) > 100000
        THEN COALESCE((SELECT SUM(sq.quantity) FROM stock sq WHERE sq.product_id = p.id), 0) <= 0
        ELSE GREATEST(0, COALESCE((SELECT SUM(sq.quantity) FROM stock sq WHERE sq.product_id = p.id), 0) - COALESCE(p.stock_reserva, 0)) < 10
      END AS is_low_stock
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
  if (notMine) {
    query += ` AND NOT EXISTS (
      SELECT 1 FROM seller_products sp2
      WHERE ($1::uuid IS NULL OR sp2.page_id = $1) AND sp2.seller_id = $2 AND sp2.product_id = p.id AND sp2.active = true
    )
    AND NOT (
      CASE
        WHEN (
          COALESCE((SELECT pc3.cost FROM product_costs pc3 WHERE pc3.product_id = p.id ORDER BY pc3.created_at DESC LIMIT 1), 0)
          * COALESCE((SELECT cfg2.cotizacion_dolar FROM price_config cfg2 WHERE cfg2.negocio_id = '00000000-0000-0000-0000-000000000001' LIMIT 1), 0)
          * 1.56
        ) > 100000
        THEN COALESCE((SELECT SUM(sq2.quantity) FROM stock sq2 WHERE sq2.product_id = p.id), 0) <= 0
        ELSE GREATEST(0, COALESCE((SELECT SUM(sq2.quantity) FROM stock sq2 WHERE sq2.product_id = p.id), 0) - COALESCE(p.stock_reserva, 0)) < 10
      END
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

export async function addProduct(pageId, sellerId, productId, customPrice) {
  await pool.query(
    `INSERT INTO seller_products (seller_id, page_id, product_id, custom_price)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (page_id, product_id) DO UPDATE SET active = true, custom_price = COALESCE($4, seller_products.custom_price)`,
    [sellerId, pageId, productId, customPrice || null]
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

export async function findById(pageId, sellerId, productId) {
  const { rows } = await pool.query(`
    SELECT
      p.id, p.code, p.name, p.description, p.active,
      p.category_id, c.name AS category_name,
      (SELECT pc.cost FROM product_costs pc
       WHERE pc.product_id = p.id ORDER BY pc.created_at DESC LIMIT 1) AS costo_usd,
      GREATEST(0, COALESCE(
        (SELECT SUM(s.quantity) FROM stock s WHERE s.product_id = p.id), 0
      ) - COALESCE(p.stock_reserva, 0)) AS available_stock,
      (SELECT sp.id FROM seller_products sp
       WHERE ($1::uuid IS NULL OR sp.page_id = $1) AND sp.seller_id = $2 AND sp.product_id = p.id AND sp.active = true LIMIT 1) AS seller_product_id,
      (SELECT sp.active FROM seller_products sp
       WHERE ($1::uuid IS NULL OR sp.page_id = $1) AND sp.seller_id = $2 AND sp.product_id = p.id AND sp.active = true LIMIT 1) AS in_my_store,
      (SELECT sp.custom_name FROM seller_products sp
       WHERE ($1::uuid IS NULL OR sp.page_id = $1) AND sp.seller_id = $2 AND sp.product_id = p.id LIMIT 1) AS custom_name,
      (SELECT sp.custom_desc FROM seller_products sp
       WHERE ($1::uuid IS NULL OR sp.page_id = $1) AND sp.seller_id = $2 AND sp.product_id = p.id LIMIT 1) AS custom_desc,
      (SELECT sp.custom_price FROM seller_products sp
       WHERE ($1::uuid IS NULL OR sp.page_id = $1) AND sp.seller_id = $2 AND sp.product_id = p.id LIMIT 1) AS custom_price,
      COALESCE((SELECT sp.free_shipping FROM seller_products sp
       WHERE ($1::uuid IS NULL OR sp.page_id = $1) AND sp.seller_id = $2 AND sp.product_id = p.id LIMIT 1), false) AS free_shipping,
      (SELECT sp.promo_price FROM seller_products sp
       WHERE ($1::uuid IS NULL OR sp.page_id = $1) AND sp.seller_id = $2 AND sp.product_id = p.id LIMIT 1) AS promo_price,
      COALESCE((SELECT sp.promo_enabled FROM seller_products sp
       WHERE ($1::uuid IS NULL OR sp.page_id = $1) AND sp.seller_id = $2 AND sp.product_id = p.id LIMIT 1), false) AS promo_enabled,
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
    WHERE p.active = true AND p.id = $3
  `, [pageId, sellerId, productId]);
  return rows[0] || null;
}

export async function customizeProduct(pageId, sellerId, productId, { custom_name, custom_desc, free_shipping }) {
  await pool.query(
    `UPDATE seller_products
     SET custom_name  = $1,
         custom_desc  = $2,
         free_shipping = COALESCE($6, free_shipping)
     WHERE page_id = $3 AND seller_id = $4 AND product_id = $5`,
    [custom_name ?? null, custom_desc ?? null, pageId, sellerId, productId,
     free_shipping != null ? Boolean(free_shipping) : null]
  );
}

export async function setFreeShipping(pageId, sellerId, productId, freeShipping) {
  await pool.query(
    `UPDATE seller_products SET free_shipping = $1
     WHERE page_id = $2 AND seller_id = $3 AND product_id = $4`,
    [Boolean(freeShipping), pageId, sellerId, productId]
  );
}

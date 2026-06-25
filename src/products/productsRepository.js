// src/modules/products/productsRepository.js
import pool from "../database/db.js"
import { NEGOCIOS_ACTIVOS } from "../config/negociosConfig.js";

// SQL fragment: "p.negocio_id = ANY(ARRAY['uuid1','uuid2']::uuid[])"
const NEGOCIO_FILTER = `p.negocio_id = ANY(ARRAY[${NEGOCIOS_ACTIVOS.map(id => `'${id}'`).join(",")}]::uuid[])`;

export async function findAll({ pageId, sellerId, search, categoryId, onlyMine, notMine, limit = 20, offset = 0 }) {
  let query = `
    SELECT
      p.id, p.code, p.name, p.description, p.active,
      p.category_id, c.name AS category_name,
      p.costo_usd, p.created_at,
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
      COALESCE((SELECT sp.colors_enabled FROM seller_products sp
       WHERE ($1::uuid IS NULL OR sp.page_id = $1) AND sp.seller_id = $2 AND sp.product_id = p.id LIMIT 1), false) AS colors_enabled,
      COALESCE((SELECT sp.colors FROM seller_products sp
       WHERE ($1::uuid IS NULL OR sp.page_id = $1) AND sp.seller_id = $2 AND sp.product_id = p.id LIMIT 1), '[]'::jsonb) AS colors,
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
      COALESCE(
        (SELECT ssr.quantity FROM seller_stock_reserves ssr
         WHERE ssr.seller_id = $2 AND ssr.product_id = p.id LIMIT 1), 0
      ) AS seller_own_stock,
      GREATEST(0,
        GREATEST(0, COALESCE((SELECT SUM(s2.quantity) FROM stock s2 WHERE s2.product_id = p.id), 0) - COALESCE(p.stock_reserva, 0))
        - COALESCE((SELECT SUM(ssr2.quantity) FROM seller_stock_reserves ssr2 WHERE ssr2.product_id = p.id), 0)
      ) AS available_for_reserve,
      CASE
        WHEN (
          COALESCE(p.costo_usd, 0)
          * COALESCE((SELECT cfg.cotizacion_dolar FROM price_config cfg WHERE cfg.negocio_id = '00000000-0000-0000-0000-000000000001' LIMIT 1), 0)
          * 1.56
        ) > 100000
        THEN COALESCE((SELECT SUM(sq.quantity) FROM stock sq WHERE sq.product_id = p.id), 0) <= 0
        ELSE GREATEST(0, COALESCE((SELECT SUM(sq.quantity) FROM stock sq WHERE sq.product_id = p.id), 0) - COALESCE(p.stock_reserva, 0)) < 10
      END AS is_low_stock
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.active = true AND ${NEGOCIO_FILTER}
      AND (
        EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id = p.id)
        OR EXISTS (SELECT 1 FROM seller_images si WHERE si.seller_id = $2 AND si.product_id = p.id)
      )
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
          COALESCE(p.costo_usd, 0)
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

  query += ` ORDER BY p.created_at DESC, p.id ASC LIMIT $${idx} OFFSET $${idx + 1}`;
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
     SELECT $1, $2, p.id FROM products p WHERE p.active = true AND ${NEGOCIO_FILTER}
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
      p.costo_usd,
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
      COALESCE((SELECT sp.colors_enabled FROM seller_products sp
       WHERE ($1::uuid IS NULL OR sp.page_id = $1) AND sp.seller_id = $2 AND sp.product_id = p.id LIMIT 1), false) AS colors_enabled,
      COALESCE((SELECT sp.colors FROM seller_products sp
       WHERE ($1::uuid IS NULL OR sp.page_id = $1) AND sp.seller_id = $2 AND sp.product_id = p.id LIMIT 1), '[]'::jsonb) AS colors,
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
    WHERE p.active = true AND ${NEGOCIO_FILTER} AND p.id = $3
  `, [pageId, sellerId, productId]);
  return rows[0] || null;
}

export async function customizeProduct(pageId, sellerId, productId, { custom_name, custom_desc, free_shipping, colors_enabled, colors }) {
  await pool.query(
    `UPDATE seller_products
     SET custom_name    = $1,
         custom_desc    = $2,
         free_shipping  = COALESCE($6, free_shipping),
         colors_enabled = COALESCE($7, colors_enabled),
         colors         = COALESCE($8, colors)
     WHERE page_id = $3 AND seller_id = $4 AND product_id = $5`,
    [custom_name ?? null, custom_desc ?? null, pageId, sellerId, productId,
     free_shipping  != null ? Boolean(free_shipping) : null,
     colors_enabled != null ? Boolean(colors_enabled) : null,
     colors         !== undefined ? JSON.stringify(colors) : null]
  );
}

export async function setFreeShipping(pageId, sellerId, productId, freeShipping) {
  await pool.query(
    `UPDATE seller_products SET free_shipping = $1
     WHERE page_id = $2 AND seller_id = $3 AND product_id = $4`,
    [Boolean(freeShipping), pageId, sellerId, productId]
  );
}

// ─── Funciones para sellerCheckoutService ────────────────────────────────────

export async function getProductForCheckout(productId) {
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.costo_usd,
            GREATEST(0,
              COALESCE((SELECT SUM(s.quantity) FROM stock s WHERE s.product_id = p.id), 0)
              - COALESCE(p.stock_reserva, 0)
              - COALESCE((SELECT SUM(ssr.quantity) FROM seller_stock_reserves ssr WHERE ssr.product_id = p.id), 0)
            ) AS available_for_reserve
     FROM products p
     WHERE p.id = $1 AND p.active = true`,
    [productId]
  );
  return rows[0] || null;
}

export async function getSellerInfo(sellerId) {
  const { rows } = await pool.query(
    `SELECT id, name, email FROM sellers WHERE id = $1`,
    [sellerId]
  );
  return rows[0] || null;
}

export async function getSellerStockReserves(sellerId) {
  const { rows } = await pool.query(
    `SELECT ssr.product_id, ssr.quantity, ssr.updated_at,
            p.name AS product_name, p.code AS product_code,
            COALESCE(
              (SELECT json_agg(pi.key ORDER BY pi.created_at) FROM product_images pi WHERE pi.product_id = p.id),
              '[]'
            ) AS images
     FROM seller_stock_reserves ssr
     JOIN products p ON p.id = ssr.product_id
     WHERE ssr.seller_id = $1 AND ssr.quantity > 0
     ORDER BY ssr.updated_at DESC`,
    [sellerId]
  );
  return rows;
}

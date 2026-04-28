// src/modules/store/storeRepository.j
import pool from "../database/db.js"
// ── Cotización ────────────────────────────────────────────────

export async function getCotizacion() {
  const { rows } = await pool.query(`SELECT cotizacion_dolar FROM price_config LIMIT 1`);
  return Number(rows[0]?.cotizacion_dolar || 1);
}

// ── Pages ─────────────────────────────────────────────────────

export async function getPages(sellerId) {
  const { rows } = await pool.query(
    `SELECT id, slug, page_name, store_name, store_description, banner_color,
            pct_markup, tagline, whatsapp, instagram, facebook, active, updated_at
     FROM seller_pages WHERE seller_id = $1 ORDER BY id ASC`,
    [sellerId]
  );
  return rows;
}

export async function getPageById(pageId, sellerId) {
  const { rows } = await pool.query(
    `SELECT * FROM seller_pages WHERE id = $1 AND seller_id = $2`,
    [pageId, sellerId]
  );
  return rows[0] || null;
}

export async function createPage(sellerId, { page_name, slug, store_name, store_description, banner_color, pct_markup, tagline, whatsapp, instagram, facebook, logo_url, font_family, color_secondary }) {
  const e = v => (v === "" ? null : (v ?? null));
  const { rows } = await pool.query(
    `INSERT INTO seller_pages
       (seller_id, page_name, slug, store_name, store_description, banner_color, pct_markup,
        tagline, whatsapp, instagram, facebook, logo_url, font_family, color_secondary, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, true)
     RETURNING *`,
    [sellerId, page_name || store_name, slug, store_name, store_description,
     banner_color || "#5b52f0", pct_markup ?? 0,
     e(tagline), e(whatsapp), e(instagram), e(facebook),
     e(logo_url), e(font_family), e(color_secondary)]
  );
  return rows[0];
}

export async function updatePage(pageId, sellerId, { page_name, store_name, store_description, banner_color, pct_markup, tagline, whatsapp, instagram, facebook, logo_url, font_family, color_secondary, color_bg, color_text, featured_categories, card_border_radius, card_show_shadow }) {
  const e = v => (v === "" ? null : (v ?? null));
  const { rows } = await pool.query(
    `UPDATE seller_pages
     SET page_name           = COALESCE($1,  page_name),
         store_name          = COALESCE($2,  store_name),
         store_description   = COALESCE($3,  store_description),
         banner_color        = COALESCE($4,  banner_color),
         pct_markup          = COALESCE($5,  pct_markup),
         tagline             = $8,
         whatsapp            = $9,
         instagram           = $10,
         facebook            = $11,
         logo_url            = $12,
         font_family         = $13,
         color_secondary     = $14,
         color_bg            = $15,
         color_text          = $16,
         featured_categories = $17,
         card_border_radius  = COALESCE($18, card_border_radius),
         card_show_shadow    = COALESCE($19, card_show_shadow),
         updated_at          = now()
     WHERE id = $6 AND seller_id = $7
     RETURNING *`,
    [page_name, store_name, store_description, banner_color, pct_markup,
     pageId, sellerId,
     e(tagline), e(whatsapp), e(instagram), e(facebook),
     e(logo_url), e(font_family), e(color_secondary), e(color_bg), e(color_text),
     featured_categories ?? null,
     card_border_radius != null ? Number(card_border_radius) : null,
     card_show_shadow   != null ? Boolean(card_show_shadow)  : null]
  );
  return rows[0];
}

export async function deletePage(pageId, sellerId) {
  const { rowCount } = await pool.query(
    `DELETE FROM seller_pages WHERE id = $1 AND seller_id = $2`,
    [pageId, sellerId]
  );
  return rowCount > 0;
}

export async function getCategories() {
  const { rows } = await pool.query(`SELECT id, name FROM categories ORDER BY name ASC`);
  return rows;
}

// Legacy single-page config (used by backward-compat routes)
export async function getConfig(sellerId) {
  const { rows } = await pool.query(
    `SELECT * FROM seller_pages WHERE seller_id = $1 ORDER BY id ASC LIMIT 1`,
    [sellerId]
  );
  return rows[0] || null;
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

export async function getCostUsdForProduct(productId) {
  const { rows } = await pool.query(
    `SELECT cost FROM product_costs WHERE product_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [productId]
  );
  return Number(rows[0]?.cost || 0);
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

export async function getPublicProducts(pageId, sellerId) {
  const { rows } = await pool.query(
    `SELECT
       p.id, p.code, p.name, p.description, p.category_id,
       c.name AS category_name,
       (SELECT pc.cost FROM product_costs pc
        WHERE pc.product_id = p.id ORDER BY pc.created_at DESC LIMIT 1) AS costo_usd,
       spc.custom_price,
       COALESCE(
         (SELECT json_agg(si.key ORDER BY si."order")
          FROM seller_images si WHERE si.seller_id = $2 AND si.product_id = p.id AND si.page_id = $1),
         (SELECT json_agg(si.key ORDER BY si."order")
          FROM seller_images si WHERE si.seller_id = $2 AND si.product_id = p.id AND si.page_id IS NULL),
         (SELECT json_agg(pi.key ORDER BY pi.created_at)
          FROM product_images pi WHERE pi.product_id = p.id),
         '[]'
       ) AS images,
       spc.custom_name,
       spc.custom_desc
     FROM seller_products spc
     JOIN products p ON p.id = spc.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE spc.page_id = $1 AND spc.active = true AND p.active = true
     ORDER BY p.name`,
    [pageId, sellerId]
  );
  return rows;
}

export async function setProductPrice(pageId, productId, customPrice) {
  const { rows } = await pool.query(
    `UPDATE seller_products SET custom_price = $1
     WHERE page_id = $2 AND product_id = $3
     RETURNING *`,
    [customPrice, pageId, productId]
  );
  return rows[0];
}

export async function createPublicOrder({ customer, total, seller_id }) {
  const { rows } = await pool.query(
    `INSERT INTO web_orders
       (customer_name, customer_email, customer_phone, customer_city, observaciones, total, seller_id, negocio_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, '00000000-0000-0000-0000-000000000002')
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

// ── Descuentos por página ─────────────────────────────────────

export async function getDiscountConfigByPage(pageId) {
  const { rows } = await pool.query(
    `SELECT * FROM seller_discounts WHERE page_id = $1`,
    [pageId]
  );
  return rows[0] || null;
}

export async function upsertDiscountConfigByPage(pageId, { enabled_quantity, enabled_price }) {
  const { rows } = await pool.query(
    `INSERT INTO seller_discounts (seller_id, enabled, discount_type, min_profit_pct, enabled_quantity, enabled_price, page_id)
     SELECT seller_id, false, 'quantity', 0, $2, $3, $1 FROM seller_pages WHERE id = $1
     ON CONFLICT (page_id) DO UPDATE
       SET enabled_quantity = EXCLUDED.enabled_quantity,
           enabled_price    = EXCLUDED.enabled_price,
           updated_at       = now()
     RETURNING *`,
    [pageId, enabled_quantity, enabled_price]
  );
  return rows[0];
}

export async function getAllDiscountTiersByPage(pageId) {
  const { rows } = await pool.query(
    `SELECT id, threshold, discount_pct, discount_type
     FROM seller_discount_tiers
     WHERE page_id = $1
     ORDER BY discount_type, threshold ASC`,
    [pageId]
  );
  return rows;
}

export async function replaceDiscountTiersByPage(pageId, discountType, tiers) {
  await pool.query(
    `DELETE FROM seller_discount_tiers WHERE page_id = $1 AND discount_type = $2`,
    [pageId, discountType]
  );
  for (const t of tiers) {
    await pool.query(
      `INSERT INTO seller_discount_tiers (seller_id, page_id, threshold, discount_pct, discount_type)
       SELECT seller_id, $1, $2, $3, $4 FROM seller_pages WHERE id = $1`,
      [pageId, t.threshold, t.discount_pct, discountType]
    );
  }
}

// Used by getPublicStore (page already known by slug)
export async function getDiscountConfig(pageId) {
  return getDiscountConfigByPage(pageId);
}
export async function getAllDiscountTiers(pageId) {
  return getAllDiscountTiersByPage(pageId);
}

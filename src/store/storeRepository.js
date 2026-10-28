// src/modules/store/storeRepository.j
import pool from "../database/db.js"
import { NEGOCIOS_ACTIVOS } from "../config/negociosConfig.js";

const NEGOCIOS_SQL = `ARRAY[${NEGOCIOS_ACTIVOS.map(id => `'${id}'`).join(",")}]::uuid[]`;
// ── Cotización ────────────────────────────────────────────────

export async function getCotizacion() {
  const { rows } = await pool.query(`SELECT cotizacion_dolar FROM price_config WHERE negocio_id = '00000000-0000-0000-0000-000000000001' LIMIT 1`);
  return Number(rows[0]?.cotizacion_dolar || 1);
}

export async function getSellerTotalSales(sellerId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(total), 0) AS total FROM web_orders WHERE seller_id = $1`,
    [sellerId]
  );
  return Number(rows[0]?.total || 0);
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

export async function updatePage(pageId, sellerId, { slug, page_name, store_name, store_description, banner_color, pct_markup, tagline, whatsapp, instagram, facebook, logo_url, font_family, color_secondary, color_bg, color_text, featured_categories, card_border_radius, card_show_shadow, hero_headline, hero_image_url, promo_text, show_promo_bar, theme_config, costo_envio, favicon_url, og_image_url, meta_title, meta_description, tiktok, youtube }) {
  const e = v => (v === "" ? null : (v ?? null));
  const { rows } = await pool.query(
    `UPDATE seller_pages
     SET page_name           = COALESCE($1,  page_name),
         store_name          = COALESCE($2,  store_name),
         store_description   = COALESCE($3,  store_description),
         banner_color        = COALESCE($4,  banner_color),
         pct_markup          = COALESCE($5,  pct_markup),
         slug                = COALESCE($8,  slug),
         tagline             = $9,
         whatsapp            = $10,
         instagram           = $11,
         facebook            = $12,
         logo_url            = $13,
         font_family         = $14,
         color_secondary     = $15,
         color_bg            = $16,
         color_text          = $17,
         featured_categories = $18,
         card_border_radius  = COALESCE($19, card_border_radius),
         card_show_shadow    = COALESCE($20, card_show_shadow),
         hero_headline       = $21,
         hero_image_url      = $22,
         promo_text          = $23,
         show_promo_bar      = COALESCE($24, show_promo_bar),
         theme_config        = COALESCE($25::jsonb, theme_config),
         costo_envio         = COALESCE($26, costo_envio),
         favicon_url         = $27,
         og_image_url        = $28,
         meta_title          = $29,
         meta_description    = $30,
         tiktok              = $31,
         youtube             = $32,
         updated_at          = now()
     WHERE id = $6 AND seller_id = $7
     RETURNING *`,
    [page_name, store_name, store_description, banner_color, pct_markup,
     pageId, sellerId,
     slug || null,
     e(tagline), e(whatsapp), e(instagram), e(facebook),
     e(logo_url), e(font_family), e(color_secondary), e(color_bg), e(color_text),
     featured_categories ?? null,
     card_border_radius != null ? Number(card_border_radius) : null,
     card_show_shadow   != null ? Boolean(card_show_shadow)  : null,
     e(hero_headline), e(hero_image_url), e(promo_text),
     show_promo_bar != null ? Boolean(show_promo_bar) : null,
     theme_config != null ? JSON.stringify(theme_config) : null,
     costo_envio != null ? Number(costo_envio) : null,
     e(favicon_url), e(og_image_url), e(meta_title), e(meta_description),
     e(tiktok), e(youtube)]
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
  const { rows } = await pool.query(
    `SELECT id, name FROM categories WHERE negocio_id = ANY(${NEGOCIOS_SQL}) ORDER BY name ASC`
  );
  return rows;
}

export async function getTransportCompanies() {
  const { rows } = await pool.query(
    `SELECT id, razon_social AS name FROM transportes ORDER BY razon_social ASC`
  );
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

// Arma el WHERE compartido por getOrders/getOrdersCount — status filtra por el color real tal
// cual lo ve el vendedor (COALESCE a 'pending', mismo default que usa el resto del código),
// search busca por número de pedido o nombre del cliente. startParamIndex es 2 por default
// porque $1 ya lo usa seller_id acá arriba.
function buildOrdersWhere(sellerId, { status, search } = {}, startParamIndex = 2) {
  const conditions = ["wo.seller_id = $1"];
  const params = [sellerId];
  let i = startParamIndex;

  if (status && status !== "all") {
    conditions.push(`COALESCE(wo.color, 'pending') = $${i}`);
    params.push(status);
    i++;
  }
  if (search && search.trim()) {
    conditions.push(`(wo.numero::text ILIKE $${i} OR wo.customer_name ILIKE $${i})`);
    params.push(`%${search.trim()}%`);
    i++;
  }
  return { where: conditions.join(" AND "), params };
}

// Paginado — 30 por carga por defecto (scroll infinito en el frontend). status/search filtran
// en la base, no en el frontend, para que la búsqueda encuentre un pedido aunque no esté entre
// los ya cargados en pantalla.
export async function getOrders(sellerId, { limit = 30, offset = 0, status, search } = {}) {
  const { where, params } = buildOrdersWhere(sellerId, { status, search });
  const { rows } = await pool.query(
    `SELECT
       wo.id, wo.numero, wo.customer_name, wo.customer_email,
       wo.customer_city, wo.total,
       COALESCE(wo.shipping_amount, 0) AS shipping_amount,
       COALESCE(wo.free_shipping_absorbed, 0) AS free_shipping_absorbed,
       wo.ml_shipping_cost, wo.ml_order_id, wo.ml_logistic_type,
       wo.color, wo.created_at, wo.order_id, wo.channel,
       COALESCE(
         (SELECT json_agg(json_build_object(
           'id',                  woi.id,
           'name',                woi.name,
           'quantity',            woi.quantity,
           'unit_price',          woi.unit_price,
           'unit_cost',           woi.unit_cost,
           'product_id',          woi.product_id,
           'selected_color_name', woi.selected_color_name,
           'selected_color_hex',  woi.selected_color_hex,
           'ml_sale_fee',         woi.ml_sale_fee,
           'ml_item_id',          woi.ml_item_id
         )) FROM web_order_items woi WHERE woi.web_order_id = wo.id),
         '[]'
       ) AS items,
       (SELECT row_to_json(os)
        FROM order_shipping os WHERE os.web_order_id = wo.id LIMIT 1
       ) AS shipping
     FROM web_orders wo
     WHERE ${where}
     ORDER BY wo.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  return rows;
}

export async function getOrdersCount(sellerId, { status, search } = {}) {
  const { where, params } = buildOrdersWhere(sellerId, { status, search });
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS c FROM web_orders wo WHERE ${where}`, params);
  return rows[0].c;
}

// Costo en USD de varios productos de una — para calcular ganancia de un lote de pedidos sin un
// round-trip a la base por ítem (ver storeService.getCostUsdByProduct).
export async function getCostUsdForProducts(productIds) {
  if (productIds.length === 0) return new Map();
  const { rows } = await pool.query(
    `SELECT id, costo_usd FROM products WHERE id = ANY($1::uuid[])`,
    [productIds]
  );
  return new Map(rows.map(r => [r.id, Number(r.costo_usd || 0)]));
}

export async function getCostUsdForProduct(productId) {
  const { rows } = await pool.query(
    `SELECT costo_usd FROM products WHERE id = $1`,
    [productId]
  );
  return Number(rows[0]?.costo_usd || 0);
}

// Completa ml_shipping_cost/ml_sale_fee cuando el webhook los guardó en null porque Mercado
// Libre todavía no los tenía calculados en el momento exacto en que llegó la notificación —
// ver storeService.backfillMissingMlFinancials.
export async function updateOrderShippingCost(orderId, shippingCost) {
  await pool.query(`UPDATE web_orders SET ml_shipping_cost = $1 WHERE id = $2`, [shippingCost, orderId]);
}

export async function updateOrderItemSaleFee(itemId, saleFee) {
  await pool.query(`UPDATE web_order_items SET ml_sale_fee = $1 WHERE id = $2`, [saleFee, itemId]);
}

// ── Tienda pública ────────────────────────────────────────────

export async function getPageBySlug(slug) {
  const { rows } = await pool.query(
    `SELECT sp.*, s.name AS seller_name
     FROM seller_pages sp
     JOIN sellers s ON s.id = sp.seller_id
     WHERE sp.slug = $1 AND sp.active = true AND s.active = true`,
    [slug]
  );
  return rows[0] || null;
}

export async function getPublicProducts(pageId, sellerId) {
  const { rows } = await pool.query(
    `SELECT
       p.id, p.code, p.name, p.description, p.category_id,
       c.name AS category_name,
       p.costo_usd,
       p.created_at,
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
       spc.custom_desc,
       COALESCE(spc.free_shipping, false) AS free_shipping,
       spc.promo_price,
       COALESCE(spc.promo_enabled, false) AS promo_enabled,
       COALESCE(spc.colors_enabled, false) AS colors_enabled,
       COALESCE(spc.colors, '[]'::jsonb) AS colors
     FROM seller_products spc
     JOIN products p ON p.id = spc.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE spc.page_id = $1 AND spc.active = true AND p.active = true
       AND p.negocio_id = ANY(${NEGOCIOS_SQL})
       AND (
         EXISTS (SELECT 1 FROM seller_images si WHERE si.seller_id = $2 AND si.product_id = p.id)
         OR EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id = p.id)
       )
       AND CASE
         WHEN (
           COALESCE(p.costo_usd, 0)
           * COALESCE((SELECT cfg.cotizacion_dolar FROM price_config cfg WHERE cfg.negocio_id = '00000000-0000-0000-0000-000000000001' LIMIT 1), 0)
           * 1.56
         ) > 100000
         THEN COALESCE((SELECT SUM(sq.quantity) FROM stock sq WHERE sq.product_id = p.id), 0) > 0
         ELSE (COALESCE((SELECT SUM(sq.quantity) FROM stock sq WHERE sq.product_id = p.id), 0) - COALESCE(p.stock_reserva, 0)) >= 10
       END
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

export async function getSellerProduct(pageId, productId) {
  const { rows } = await pool.query(
    `SELECT * FROM seller_products WHERE page_id = $1 AND product_id = $2`,
    [pageId, productId]
  );
  return rows[0] || null;
}

export async function updateProductPromo(pageId, productId, promoPrice, promoEnabled) {
  const { rows } = await pool.query(
    `UPDATE seller_products SET promo_price = $1, promo_enabled = $2
     WHERE page_id = $3 AND product_id = $4
     RETURNING *`,
    [promoPrice, promoEnabled, pageId, productId]
  );
  return rows[0];
}

export async function createPublicOrder({ customer, total, seller_id }) {
  const { rows } = await pool.query(
    `INSERT INTO web_orders
       (numero, customer_name, customer_email, customer_phone, customer_city, observaciones, total, seller_id, negocio_id)
     VALUES (
       (SELECT COALESCE(MAX(numero), 0) + 1 FROM web_orders WHERE seller_id = $7),
       $1, $2, $3, $4, $5, $6, $7, '00000000-0000-0000-0000-000000000002'
     )
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

export async function getSellerActivePage(sellerId) {
  const { rows } = await pool.query(
    `SELECT slug, store_name FROM seller_pages WHERE seller_id = $1 AND active = true LIMIT 1`,
    [sellerId]
  );
  return rows[0] || null;
}

// Used by getPublicStore (page already known by slug)
export async function getDiscountConfig(pageId) {
  return getDiscountConfigByPage(pageId);
}
export async function getAllDiscountTiers(pageId) {
  return getAllDiscountTiersByPage(pageId);
}

import pool from "../database/db.js";

export async function createOAuthState(sellerId) {
  const { rows } = await pool.query(
    `INSERT INTO ml_oauth_states (seller_id) VALUES ($1) RETURNING state`,
    [sellerId]
  );
  return rows[0].state;
}

// Consume el state (lo marca como usado) y retorna el seller_id.
// Falla si ya fue usado o tiene más de 10 minutos.
export async function consumeOAuthState(state) {
  const { rows } = await pool.query(
    `UPDATE ml_oauth_states
     SET used = true
     WHERE state = $1 AND used = false AND created_at > now() - interval '10 minutes'
     RETURNING seller_id`,
    [state]
  );
  return rows[0]?.seller_id || null;
}

export async function upsertConnection(sellerId, { accessToken, refreshToken, expiresAt, mlUserId, mlNickname, siteId }) {
  await pool.query(
    `INSERT INTO ml_connections (seller_id, access_token, refresh_token, token_expires_at, ml_user_id, ml_nickname, site_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (seller_id) DO UPDATE SET
       access_token     = EXCLUDED.access_token,
       refresh_token    = EXCLUDED.refresh_token,
       token_expires_at = EXCLUDED.token_expires_at,
       ml_user_id       = EXCLUDED.ml_user_id,
       ml_nickname      = EXCLUDED.ml_nickname,
       site_id          = EXCLUDED.site_id,
       updated_at       = now()`,
    [sellerId, accessToken, refreshToken, expiresAt, mlUserId, mlNickname, siteId || "MLA"]
  );
}

// ml_user_id IS NOT NULL es la señal real de "conectado" — la fila puede seguir existiendo
// después de un disconnect (ver deleteConnection) solo para no perder la tarjeta guardada.
export async function getConnection(sellerId) {
  const { rows } = await pool.query(
    `SELECT id, seller_id, token_expires_at, ml_user_id, ml_nickname, site_id, updated_at
     FROM ml_connections WHERE seller_id = $1 AND ml_user_id IS NOT NULL`,
    [sellerId]
  );
  return rows[0] || null;
}

export async function getConnectionByMlUserId(mlUserId) {
  const { rows } = await pool.query(
    `SELECT * FROM ml_connections WHERE ml_user_id = $1`,
    [String(mlUserId)]
  );
  return rows[0] || null;
}

export async function getConnectionWithToken(sellerId) {
  const { rows } = await pool.query(
    `SELECT * FROM ml_connections WHERE seller_id = $1 AND ml_user_id IS NOT NULL`,
    [sellerId]
  );
  return rows[0] || null;
}

export async function updateTokens(sellerId, { accessToken, refreshToken, expiresAt }) {
  await pool.query(
    `UPDATE ml_connections
     SET access_token = $1, refresh_token = $2, token_expires_at = $3, updated_at = now()
     WHERE seller_id = $4`,
    [accessToken, refreshToken, expiresAt, sellerId]
  );
}

// Solo limpia los datos de la conexión OAuth con Mercado Libre — NUNCA borra la fila entera,
// porque ahí también viven mp_customer_id/mp_card_id/etc. (la tarjeta guardada del seller,
// que es independiente de qué cuenta de ML esté conectada en un momento dado). Un DELETE acá
// hacía que reconectar con otra cuenta de ML obligara a volver a cargar la tarjeta de cero.
export async function deleteConnection(sellerId) {
  await pool.query(
    `UPDATE ml_connections
     SET access_token = NULL, refresh_token = NULL, token_expires_at = NULL,
         ml_user_id = NULL, ml_nickname = NULL, site_id = NULL, updated_at = now()
     WHERE seller_id = $1`,
    [sellerId]
  );
}

// ── Combos de ML ───────────────────────────────────────────────

// A diferencia de los combos de tienda (page_combos), no llevan nombre elegido por el
// vendedor ni fotos propias — se arma un nombre a partir de los productos y las fotos se
// completan automáticamente al publicar (ver mlListingService.publishCombo).
export async function createCombo(sellerId, products) {
  const displayName = products.map(p => `${p.quantity > 1 ? `${p.quantity}× ` : ""}${p.name}`).join(" + ");
  const { rows } = await pool.query(
    `INSERT INTO ml_combos (seller_id, name) VALUES ($1, $2) RETURNING id`,
    [sellerId, displayName]
  );
  const comboId = rows[0].id;
  for (const p of products) {
    await pool.query(
      `INSERT INTO ml_combo_products (ml_combo_id, product_id, quantity) VALUES ($1, $2, $3)`,
      [comboId, p.productId, Math.max(1, p.quantity || 1)]
    );
  }
  return comboId;
}

export async function isComboOwned(comboId, sellerId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM ml_combos WHERE id = $1 AND seller_id = $2`,
    [comboId, sellerId]
  );
  return rows.length > 0;
}

// Productos del combo con su costo/peso/volumen/stock disponible — todo lo necesario para
// armar la publicación (precio piso, dimensiones de envío, stock, fotos).
// Búsqueda liviana de productos del catálogo para autocompletar la calculadora de ML (peso y
// costo real en vez de cargarlos a mano) — mismo criterio de mlListingService.publishProduct,
// que tampoco filtra por vendedor (cualquier producto activo del catálogo se puede publicar).
export async function searchProductsForListing(search) {
  const { rows } = await pool.query(
    `SELECT id, name, costo_usd, weight_grams, volume_cm3
     FROM products WHERE active = true AND name ILIKE $1
     ORDER BY name LIMIT 10`,
    [`%${search}%`]
  );
  return rows;
}

export async function getComboProducts(comboId) {
  const { rows } = await pool.query(
    `SELECT cp.product_id, cp.quantity, p.name, p.description, p.costo_usd, p.weight_grams, p.volume_cm3,
            GREATEST(0, COALESCE((SELECT SUM(s.quantity) FROM stock s WHERE s.product_id = p.id), 0)
              - COALESCE(p.stock_reserva, 0)) AS available_stock
     FROM ml_combo_products cp
     JOIN products p ON p.id = cp.product_id
     WHERE cp.ml_combo_id = $1
     ORDER BY cp.id`,
    [comboId]
  );
  return rows;
}

export async function getComboName(comboId) {
  const { rows } = await pool.query(`SELECT name FROM ml_combos WHERE id = $1`, [comboId]);
  return rows[0]?.name || null;
}

// Reemplaza las cantidades del combo — se usa desde el modal de publicar cuando el vendedor
// ajusta cuántas unidades de cada producto van en el combo antes de publicarlo.
export async function updateComboProducts(comboId, products) {
  await pool.query(`DELETE FROM ml_combo_products WHERE ml_combo_id = $1`, [comboId]);
  for (const p of products) {
    await pool.query(
      `INSERT INTO ml_combo_products (ml_combo_id, product_id, quantity) VALUES ($1, $2, $3)`,
      [comboId, p.productId, Math.max(1, p.quantity || 1)]
    );
  }
  const displayName = products.map(p => `${p.quantity > 1 ? `${p.quantity}× ` : ""}${p.name || ""}`).join(" + ");
  if (displayName.trim()) {
    await pool.query(`UPDATE ml_combos SET name = $1 WHERE id = $2`, [displayName, comboId]);
  }
}

// ── Listings ─────────────────────────────────────────────────

// Cada publish() crea un ítem nuevo en ML (mlItemId nuevo siempre) — nunca es un "update" de
// una fila existente. Un mismo producto puede tener varias filas: de distintos vendedores
// (catálogo compartido) o del mismo vendedor publicando el mismo producto más de una vez con
// distinto precio/cuotas. ml_item_id (no product_id) es lo único que identifica una publicación.
// Una publicación representa un producto (productId) O un combo (comboId), nunca los dos.
export async function createListing(sellerId, { productId, comboId, mlItemId, categoryId, status, permalink, price, mlCategoryId, attributes, shippingFree }) {
  const { rows } = await pool.query(
    `INSERT INTO ml_listings (seller_id, product_id, ml_combo_id, ml_item_id, category_id, status, permalink, price, ml_category_id, attributes, shipping_free)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [sellerId, productId || null, comboId || null, mlItemId, categoryId || null, status || "active", permalink || null,
     price ?? null, mlCategoryId || null, JSON.stringify(attributes || []), !!shippingFree]
  );
  return rows[0];
}

export async function updateListingStatus(mlItemId, status, pauseReason = null) {
  await pool.query(
    `UPDATE ml_listings SET status = $1, pause_reason = $2, updated_at = now() WHERE ml_item_id = $3`,
    [status, status === "active" ? null : pauseReason, mlItemId]
  );
}

export async function setAllListingsStatus(sellerId, status, pauseReason = null) {
  const { rows } = await pool.query(
    `UPDATE ml_listings SET status = $1, pause_reason = $2, updated_at = now()
     WHERE seller_id = $3 AND status != 'closed' RETURNING ml_item_id`,
    [status, pauseReason, sellerId]
  );
  return rows.map(r => r.ml_item_id);
}

export async function countActiveListings(sellerId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM ml_listings WHERE seller_id = $1 AND status = 'active'`,
    [sellerId]
  );
  return rows[0].count;
}

// Al vencer la prueba gratis o el plan pago, se pausan las publicaciones que estén activas EN
// ESE MOMENTO — a propósito no toca las que ya estaban pausadas por otra razón (stock, cobro
// fallido, manual), así al reactivar no se les pisa su verdadero motivo de pausa.
export async function pauseListingsForPlanExpiration(sellerId) {
  const { rows } = await pool.query(
    `UPDATE ml_listings SET status = 'paused', pause_reason = 'plan_expired', updated_at = now()
     WHERE seller_id = $1 AND status = 'active' RETURNING ml_item_id`,
    [sellerId]
  );
  return rows.map(r => r.ml_item_id);
}

// Al pagar/renovar, solo reactiva las que se pausaron automáticamente por vencimiento de plan
// — las pausadas por stock/cobro/manual quedan como están.
export async function reactivateListingsAfterPlanRenewal(sellerId) {
  const { rows } = await pool.query(
    `UPDATE ml_listings SET status = 'active', pause_reason = NULL, updated_at = now()
     WHERE seller_id = $1 AND status = 'paused' AND pause_reason = 'plan_expired' RETURNING ml_item_id`,
    [sellerId]
  );
  return rows.map(r => r.ml_item_id);
}

// Al cobrar bien la deuda obligatoria (en el corte diario o con el botón de pago manual), solo
// reactiva las que se habían pausado por esa razón puntual — las pausadas por stock/plan/manual
// quedan como están.
export async function reactivateListingsAfterChargeSuccess(sellerId) {
  const { rows } = await pool.query(
    `UPDATE ml_listings SET status = 'active', pause_reason = NULL, updated_at = now()
     WHERE seller_id = $1 AND status = 'paused' AND pause_reason = 'charge_failed' RETURNING ml_item_id`,
    [sellerId]
  );
  return rows.map(r => r.ml_item_id);
}

// Listings activos con su stock físico disponible — para el job de auto-pause por stock.
// Trae todo lo necesario para decidir si hay que pausar/reactivar cada publicación de ML
// por stock, y para el mail correspondiente. El stock "efectivo" de un seller es su propia
// reserva (garantizada solo para él) más lo que quede del pool compartido sin reservar por
// nadie — así un seller con reserva propia no se ve afectado por el consumo de otros.
export async function getActiveListingsWithStock() {
  const { rows } = await pool.query(
    `SELECT l.seller_id, l.ml_item_id, l.product_id, l.status, l.pause_reason, l.permalink,
            p.name AS product_name, p.code AS product_code, p.costo_usd,
            s.email AS seller_email, s.name AS seller_name,
            COALESCE((SELECT ssr.quantity FROM seller_stock_reserves ssr
                      WHERE ssr.seller_id = l.seller_id AND ssr.product_id = l.product_id), 0) AS seller_own_reserve,
            GREATEST(0,
              GREATEST(0, COALESCE((SELECT SUM(s2.quantity) FROM stock s2 WHERE s2.product_id = l.product_id), 0)
                - COALESCE(p.stock_reserva, 0))
              - COALESCE((SELECT SUM(ssr2.quantity) FROM seller_stock_reserves ssr2 WHERE ssr2.product_id = l.product_id), 0)
            ) AS shared_available,
            COALESCE((SELECT cfg.cotizacion_dolar FROM price_config cfg WHERE cfg.negocio_id = '00000000-0000-0000-0000-000000000001' LIMIT 1), 0) AS cotizacion
     FROM ml_listings l
     JOIN products p ON p.id = l.product_id
     JOIN sellers s  ON s.id = l.seller_id
     WHERE l.status IN ('active', 'paused')`
  );
  return rows.map(r => ({
    ...r,
    available_stock: Number(r.seller_own_reserve) + Number(r.shared_available),
  }));
}

// Publicaciones de COMBOS de ML activas/pausadas — separado de getActiveListingsWithStock()
// porque un combo no tiene product_id propio (JOIN directo con products lo descartaría). El
// stock disponible de cada producto se calcula acá con la misma fórmula simple que ya usa
// mlRepository.getComboProducts()/mlListingService.publishCombo (no la versión "aware" de
// reservas de otros sellers que usa getActiveListingsWithStock — se mantiene consistente con
// lo que el vendedor vio al publicar el combo).
export async function getActiveComboListings() {
  const { rows } = await pool.query(
    `SELECT l.seller_id, l.ml_item_id, l.ml_combo_id, l.status, l.pause_reason, l.permalink,
            c.name AS combo_name,
            s.email AS seller_email, s.name AS seller_name,
            COALESCE((SELECT cfg.cotizacion_dolar FROM price_config cfg WHERE cfg.negocio_id = '00000000-0000-0000-0000-000000000001' LIMIT 1), 0) AS cotizacion
     FROM ml_listings l
     JOIN ml_combos c ON c.id = l.ml_combo_id
     JOIN sellers s  ON s.id = l.seller_id
     WHERE l.status IN ('active', 'paused')`
  );
  return rows;
}

// Por ml_item_id, no por product_id — un mismo producto puede tener varias publicaciones
// (de distintos vendedores, o del mismo vendedor con distinto precio/cuotas) y cada una
// puede tener su propio precio/categoría, así que hay que identificar la publicación exacta.
export async function getListingByMlItemId(mlItemId) {
  const { rows } = await pool.query(
    `SELECT * FROM ml_listings WHERE ml_item_id = $1`,
    [mlItemId]
  );
  return rows[0] || null;
}

export async function getListingsBySeller(sellerId) {
  const { rows } = await pool.query(
    `SELECT l.*, p.name AS product_name, p.code AS sku,
            (SELECT key FROM product_images WHERE product_id = p.id ORDER BY created_at LIMIT 1) AS image_key,
            GREATEST(0, COALESCE((SELECT SUM(s.quantity) FROM stock s WHERE s.product_id = p.id), 0)
              - COALESCE(p.stock_reserva, 0)) AS available_stock,
            COALESCE((
              SELECT SUM(woi.quantity) FROM web_order_items woi
              JOIN web_orders wo ON wo.id = woi.web_order_id
              WHERE woi.product_id = p.id AND wo.seller_id = l.seller_id AND wo.channel = 'mercadolibre'
            ), 0) AS units_sold,
            mc.name AS combo_name
     FROM ml_listings l
     LEFT JOIN products p ON p.id = l.product_id
     LEFT JOIN ml_combos mc ON mc.id = l.ml_combo_id
     WHERE l.seller_id = $1
     ORDER BY l.updated_at DESC`,
    [sellerId]
  );

  const comboIds = rows.filter(r => r.ml_combo_id).map(r => r.ml_combo_id);
  if (comboIds.length === 0) return rows;

  const comboDetails = await getComboDisplayDetails(comboIds);
  return rows.map(r => {
    if (!r.ml_combo_id) return r;
    const d = comboDetails.get(r.ml_combo_id);
    return {
      ...r,
      product_name: r.combo_name,
      sku: `Combo (${d?.count || 0} productos)`,
      image_key: d?.imageKey || null,
      available_stock: d?.availableStock ?? 0,
      units_sold: d?.unitsSold ?? 0,
    };
  });
}

// Datos "de vidriera" de un combo para la lista de publicaciones — imagen representativa,
// stock disponible (limitado por el producto que primero se agota, según cuántos hacen falta
// de cada uno) y una estimación de unidades vendidas (aproximada, usando el primer producto
// del combo como referencia — mismo nivel de precisión que ya se acepta para productos sueltos
// cuando un mismo producto tiene más de una publicación).
async function getComboDisplayDetails(comboIds) {
  const { rows } = await pool.query(
    `SELECT cp.ml_combo_id, cp.product_id, cp.quantity, p.name,
            (SELECT key FROM product_images WHERE product_id = p.id ORDER BY created_at LIMIT 1) AS image_key,
            GREATEST(0, COALESCE((SELECT SUM(s.quantity) FROM stock s WHERE s.product_id = p.id), 0)
              - COALESCE(p.stock_reserva, 0)) AS product_available_stock,
            COALESCE((
              SELECT SUM(woi.quantity) FROM web_order_items woi
              JOIN web_orders wo ON wo.id = woi.web_order_id
              WHERE woi.product_id = cp.product_id AND wo.seller_id = mc.seller_id AND wo.channel = 'mercadolibre'
            ), 0) AS product_units_sold
     FROM ml_combo_products cp
     JOIN ml_combos mc ON mc.id = cp.ml_combo_id
     JOIN products p ON p.id = cp.product_id
     WHERE cp.ml_combo_id = ANY($1::uuid[])
     ORDER BY cp.id`,
    [comboIds]
  );

  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.ml_combo_id)) map.set(row.ml_combo_id, []);
    map.get(row.ml_combo_id).push(row);
  }

  const result = new Map();
  for (const [comboId, products] of map) {
    result.set(comboId, {
      count: products.length,
      imageKey: products.find(p => p.image_key)?.image_key || null,
      availableStock: Math.min(...products.map(p => Math.floor(Number(p.product_available_stock) / (p.quantity || 1)))),
      unitsSold: Math.floor(Number(products[0].product_units_sold) / (products[0].quantity || 1)),
    });
  }
  return result;
}

// Resumen agregado para la pestaña "Resumen" — evita que el vendedor tenga que abrir
// cada publicación para saber si algo necesita atención.
export async function getSummary(sellerId) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'active')::int  AS active_count,
       COUNT(*) FILTER (WHERE status = 'paused')::int  AS paused_count,
       COUNT(*) FILTER (WHERE status = 'paused' AND pause_reason = 'charge_failed')::int AS error_count,
       COUNT(*) FILTER (WHERE status = 'paused' AND pause_reason = 'stock')::int AS stock_paused_count,
       COUNT(*)::int AS total_count
     FROM ml_listings WHERE seller_id = $1`,
    [sellerId]
  );

  const { rows: salesRows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)::int AS sales_today,
       MAX(created_at) AS last_sale_at
     FROM web_orders WHERE seller_id = $1 AND channel = 'mercadolibre'`,
    [sellerId]
  );

  return { ...rows[0], ...salesRows[0] };
}

export async function deleteListing(mlItemId) {
  await pool.query(`DELETE FROM ml_listings WHERE ml_item_id = $1`, [mlItemId]);
}

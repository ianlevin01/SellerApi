const CLIENT_ID     = process.env.ML_CLIENT_ID;
const CLIENT_SECRET = process.env.ML_CLIENT_SECRET;
const REDIRECT_URI  = process.env.ML_REDIRECT_URI || "https://api.ventaz.online/seller/ml/callback";
const AUTH_DOMAIN    = "https://auth.mercadolibre.com.ar";
const API_BASE       = "https://api.mercadolibre.com";

export function getOAuthUrl(state) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    state,
  });
  return `${AUTH_DOMAIN}/authorization?${params}`;
}

async function apiGet(path, token) {
  const res  = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("[mlService] GET error", path, JSON.stringify(data));
    throw new Error(`ML API: ${data.message || data.error || res.statusText}`);
  }
  return data;
}

async function tokenRequest(params) {
  const res = await fetch(`${API_BASE}/oauth/token`, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body:    new URLSearchParams(params).toString(),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("[mlService] token error", JSON.stringify(data));
    throw new Error(`ML API: ${data.message || data.error || res.statusText}`);
  }
  return data;
}

export async function exchangeCodeForToken(code) {
  const data = await tokenRequest({
    grant_type:    "authorization_code",
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
    redirect_uri:  REDIRECT_URI,
  });
  return {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token,
    expiresAt:    new Date(Date.now() + Number(data.expires_in) * 1000),
    mlUserId:     String(data.user_id),
  };
}

export async function refreshAccessToken(refreshToken) {
  const data = await tokenRequest({
    grant_type:    "refresh_token",
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: refreshToken,
  });
  return {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token,
    expiresAt:    new Date(Date.now() + Number(data.expires_in) * 1000),
  };
}

export async function getUser(token) {
  const data = await apiGet("/users/me", token);
  return { id: String(data.id), nickname: data.nickname, siteId: data.site_id };
}

// Crea un usuario de prueba de ML (comprador o vendedor, según cómo se use después) — no
// hace falta un access_token específico, cualquier token válido de la app sirve. Solo se
// puede usar una vez creado inmediatamente: ML no guarda un listado para volver a consultarlo.
export async function createTestUser(token, siteId = "MLA") {
  const res = await fetch(`${API_BASE}/users/test_user`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ site_id: siteId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`ML API: ${data.message || data.error || res.statusText}`);
  return data; // { id, nickname, password, site_status, ... }
}

async function apiWriteRaw(method, path, token, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

function throwWriteError(method, path, data, statusText) {
  console.error("[mlService] write error", method, path, JSON.stringify(data));
  const causeDetail = Array.isArray(data.cause) && data.cause.length
    ? " — " + data.cause.map(c => c.message || c.code).filter(Boolean).join("; ")
    : "";
  throw new Error(`ML API: ${data.message || data.error || statusText}${causeDetail}`);
}

async function apiWrite(method, path, token, body) {
  const { ok, data, status } = await apiWriteRaw(method, path, token, body);
  if (!ok) throwWriteError(method, path, data, status);
  return data;
}

// Sugerencia de categoría de ML a partir de un título — la categoría interna de Ventaz
// no corresponde a la taxonomía de ML, hay que mapear.
// Trae también la miga de pan completa de cada categoría sugerida (igual que muestra la
// propia Mercado Libre al elegir categoría) — sin esto, categorías con nombres parecidos
// pero de rubros distintos son imposibles de distinguir en la lista.
export async function suggestCategory(siteId, query) {
  const data = await apiGet(`/sites/${siteId}/domain_discovery/search?q=${encodeURIComponent(query)}`);
  const suggestions = data.map(d => ({ categoryId: d.category_id, categoryName: d.category_name }));
  const paths = await Promise.all(suggestions.map(s => getCategoryPath(s.categoryId).catch(() => null)));
  return suggestions.map((s, i) => ({ ...s, path: paths[i] }));
}

export async function getCategoryPath(categoryId) {
  const data = await apiGet(`/categories/${categoryId}`);
  return (data.path_from_root || []).map(p => p.name).join(" > ");
}

// EMPTY_GTIN_REASON y GTIN se manejan solos (ver mlListingService.fillMissingGtinExemption) —
// nunca se le muestran al vendedor. El resto de los atributos "hidden"/"read_only" (código
// hazmat, características químicas, campos que calcula ML solo, etc.) tampoco son para que
// el vendedor complete a mano — Mercado Libre los marca así en su propia API.
const NEVER_SHOW_ATTRS = new Set(["GTIN", "EMPTY_GTIN_REASON"]);

// Los atributos "number_unit" (LENGTH, WEIGHT, MIN_RECOMMENDED_AGE, etc.) cada uno tiene su
// propia unidad válida (cm, g, años...) — ML la manda en allowed_units/default_unit. Sin esto,
// el front no tiene forma de saber que MIN_RECOMMENDED_AGE se mide en años y no en cm.
function normalizeUnit(u) {
  if (!u) return null;
  return typeof u === "string" ? u : (u.name || u.id || null);
}

export async function getCategoryAttributes(categoryId) {
  const data = await apiGet(`/categories/${categoryId}/attributes`);
  return data
    .filter(a => !NEVER_SHOW_ATTRS.has(a.id) && !a.tags?.hidden && !a.tags?.read_only)
    .map(a => ({
      id: a.id, name: a.name, required: a.tags?.required || false,
      valueType: a.value_type, values: a.values,
      defaultUnit: normalizeUnit(a.default_unit) || normalizeUnit(a.allowed_units?.[0]),
    }));
}

// Sin filtrar — a diferencia de getCategoryAttributes (pensada para mostrarle al vendedor en el
// wizard), esta trae TODOS los atributos tal cual los manda ML, incluyendo GTIN/EMPTY_GTIN_REASON
// (que la de arriba excluye a propósito). fillMissingGtinExemption necesita ver EMPTY_GTIN_REASON
// con sus `values` para poder completarlo solo — si usara la versión filtrada nunca lo iba a
// encontrar (siempre queda afuera por NEVER_SHOW_ATTRS), y por eso GTIN terminaba rechazando la
// publicación igual pese a que fillMissingGtinExemption existe justo para evitar eso.
export async function getRawCategoryAttributes(categoryId) {
  return apiGet(`/categories/${categoryId}/attributes`);
}

// Algunas categorías ya usan el modelo nuevo de ML ("User Products"/variaciones, pide
// `family_name` y rechaza `title`) y otras todavía usan el modelo clásico (pide `title` y
// rechaza `family_name`) — no hay forma de saber cuál es de antemano sin probar, así que
// detectamos el rechazo puntual y reintentamos con el otro campo.
function needsClassicTitleFallback(data) {
  const causes = Array.isArray(data.cause) ? data.cause : [];
  const text = [data.message, ...causes.map(c => c.message)].filter(Boolean).join(" ").toLowerCase();
  return text.includes("family") && text.includes("title");
}

// pictures: array ya armado de referencias de ML — { source: url } para imágenes ya
// hosteadas (ej. las de S3), o { id: picture_id } para las subidas vía uploadPicture().
// dimensions: "LxWxHcm,pesoGramos" — sin esto ML no puede calcular bien costo/tiempo de envío
// y suele caer a una estimación genérica (lenta y cara).
export async function createItem(token, { title, categoryId, price, currencyId = "ARS", stock, condition = "new", description, pictures, attributes, listingTypeId = "gold_special", shippingFree, dimensions }) {
  const baseBody = {
    category_id: categoryId, price, currency_id: currencyId,
    available_quantity: stock, buying_mode: "buy_it_now", condition,
    listing_type_id: listingTypeId,
    pictures: pictures || [],
    attributes: attributes || [],
    shipping: { mode: "me2", free_shipping: !!shippingFree, ...(dimensions ? { dimensions } : {}) },
  };

  let result = await apiWriteRaw("POST", "/items", token, {
    ...baseBody,
    family_name: String(title || "").slice(0, 60),
  });

  if (!result.ok && needsClassicTitleFallback(result.data)) {
    console.warn("[mlService] categoría usa el modelo clásico (title), reintentando sin family_name");
    result = await apiWriteRaw("POST", "/items", token, { ...baseBody, title });
  }

  if (!result.ok) throwWriteError("POST", "/items", result.data, result.status);
  const item = result.data;

  if (description) {
    await apiWrite("POST", `/items/${item.id}/description`, token, { plain_text: description }).catch(() => {});
  }
  return { mlItemId: item.id, permalink: item.permalink, status: item.status };
}

// Sube una imagen directo a la API de Pictures de ML (sin pasar por nuestro S3) — devuelve
// un picture_id que se referencia en el array `pictures` de createItem como { id: picture_id }.
export async function uploadPicture(token, buffer, filename, mimetype) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimetype }), filename);

  const res = await fetch(`${API_BASE}/pictures/items/upload`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}` },
    body:    form,
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("[mlService] uploadPicture error", JSON.stringify(data));
    throw new Error(`ML API: ${data.message || data.error || res.statusText}`);
  }
  return data.id;
}

export async function updateItem(token, itemId, updates) {
  return apiWrite("PUT", `/items/${itemId}`, token, updates);
}

export async function setItemStatus(token, itemId, status) {
  return apiWrite("PUT", `/items/${itemId}`, token, { status }); // 'active' | 'paused'
}

export async function getOrder(token, orderId) {
  return apiGet(`/orders/${orderId}`, token);
}

export async function getShipment(token, shipmentId) {
  return apiGet(`/shipments/${shipmentId}`, token);
}

export async function getItem(token, itemId) {
  return apiGet(`/items/${itemId}`, token);
}

async function fetchListingPrices(token, siteId, { price, categoryId, listingTypeId }) {
  const params = new URLSearchParams({ price, category_id: categoryId, listing_type_id: listingTypeId });
  const data = await apiGet(`/sites/${siteId}/listing_prices?${params}`, token);
  return Array.isArray(data) ? data[0] : data;
}

// Desglose de comisión/costos de ML para un precio+categoría — lo mismo que ML muestra
// como "Recibís" al publicar. No hace falta el ítem creado, solo precio/categoría/tipo de listado.
//
// Las cuotas sin interés en ML no se activan con un parámetro suelto en este endpoint — están
// atadas al listing_type: "Clásica" (gold_special) nunca las incluye, "Premium" (gold_pro) sí,
// a cambio de una comisión más alta. Por eso para poder ofrecerle al vendedor la opción de
// "ofrecer cuotas" consultamos los dos tipos en paralelo y calculamos la diferencia — no todas
// las categorías tienen Premium disponible, si falla simplemente no se ofrece la opción.
export async function getListingFees(token, siteId, { price, categoryId, listingTypeId = "gold_special" }) {
  const [classic, premium] = await Promise.all([
    fetchListingPrices(token, siteId, { price, categoryId, listingTypeId }),
    fetchListingPrices(token, siteId, { price, categoryId, listingTypeId: "gold_pro" }).catch(() => null),
  ]);

  const saleFee = Number(classic?.sale_fee_amount || 0);
  const premiumFee = premium ? Number(premium.sale_fee_amount || 0) : null;

  return {
    saleFeeAmount: saleFee,
    netAmount:     Number(price) - saleFee,
    listingTypeId: classic?.listing_type_name || listingTypeId,
    // Costo adicional de pasar a Premium para poder ofrecer cuotas sin interés — null si esa
    // categoría no tiene Premium disponible (no se debe mostrar la opción en ese caso).
    installments: premiumFee !== null ? { extraCost: Math.max(0, premiumFee - saleFee) } : null,
  };
}

// Costo estimado de asumir el envío gratis para el comprador — mismo simulador que usa ML
// antes de publicar (GET /users/{user_id}/shipping_options/free). dimensions viene en el mismo
// formato "LxWxHxpeso" que ya arma mlListingService.estimateShippingDimensions(). Solo mandamos
// los parámetros realmente necesarios (dimensions, precio, tipo de listado) — mode/logistic_type
// quedan a criterio de ML según cómo tenga configurado el vendedor su cuenta; forzarlos a un
// valor fijo podía estar devolviendo $0 para cuentas que no calzaban con esa combinación puntual.
export async function getShippingCostEstimate(token, mlUserId, { price, dimensions, listingTypeId = "gold_special" }) {
  const params = new URLSearchParams({
    dimensions, verbose: "true", item_price: price, listing_type_id: listingTypeId,
  });
  const data = await apiGet(`/users/${mlUserId}/shipping_options/free?${params}`, token);
  const option = Array.isArray(data?.options) ? data.options[0] : (Array.isArray(data) ? data[0] : data);
  return {
    cost:     Number(option?.cost ?? option?.list_cost ?? 0),
    listCost: Number(option?.list_cost ?? option?.cost ?? 0),
  };
}

// Visitas + unidades vendidas + calidad de una publicación ya creada.
export async function getItemStats(token, itemId) {
  const [item, visitsData, healthData] = await Promise.all([
    apiGet(`/items/${itemId}?attributes=sold_quantity`, token),
    apiGet(`/items/${itemId}/visits`, token).catch(() => null),
    apiGet(`/items/${itemId}/health`, token).catch(() => null),
  ]);
  return {
    soldQuantity: item?.sold_quantity || 0,
    visits: visitsData?.total_visits || 0,
    health: healthData ? { pct: healthData.health, level: healthData.level } : null,
  };
}

export async function getQuestion(token, questionId) {
  return apiGet(`/questions/${questionId}`, token);
}

// Etiquetas de envío en PDF para uno o más shipments del MISMO vendedor (máximo 50 por
// request, límite de la propia API de ML). Requiere que el shipment esté en
// ready_to_ship/ready_to_print — si no, ML devuelve error.
export async function getShipmentLabelsPdf(token, shipmentIds) {
  const res = await fetch(`${API_BASE}/shipment_labels?shipment_ids=${shipmentIds.join(",")}&response_type=pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    console.error("[mlService] getShipmentLabelsPdf error", JSON.stringify(data));
    throw new Error(`ML API: ${data.message || data.error || res.statusText}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

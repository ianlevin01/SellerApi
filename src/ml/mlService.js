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
//
// VALUE_ADDED_TAX (IVA) e IMPORT_DUTY (Impuesto interno) son datos fiscales del propio
// vendedor (según su condición ante IVA — Responsable Inscripto, Monotributista, etc.) y del
// producto puntual — Ventaz no tiene forma de saber ese dato por el vendedor, así que no tiene
// sentido pedírselo en el wizard de publicación. Si la categoría lo exige como obligatorio, el
// mecanismo genérico de atributo faltante (ver createMlItem) lo va a pedir en su momento.
const NEVER_SHOW_ATTRS = new Set(["GTIN", "EMPTY_GTIN_REASON", "VALUE_ADDED_TAX", "IMPORT_DUTY"]);

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
export async function createItem(token, { title, categoryId, price, currencyId = "ARS", stock, condition = "new", description, pictures, attributes, listingTypeId = "gold_special", shippingFree, dimensions, tags }) {
  const baseBody = {
    category_id: categoryId, price, currency_id: currencyId,
    available_quantity: stock, buying_mode: "buy_it_now", condition,
    listing_type_id: listingTypeId,
    pictures: pictures || [],
    attributes: attributes || [],
    shipping: { mode: "me2", free_shipping: !!shippingFree, ...(dimensions ? { dimensions } : {}) },
    // Activa la campaña de cuotas elegida (cuota-simple-3/6/9/12, pcj-co-funded, etc.) — sin
    // esto el ítem se crea con el listing_type_id correcto pero SIN la campaña puntual habilitada.
    ...(tags?.length ? { tags } : {}),
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

// Fecha/hora límite real para este envío — { status: "on_time"|..., expected_date, service,
// last_updated }. La define Mercado Libre por zona y cambia día a día, no es algo que se pueda
// calcular del lado de Ventaz. Para Correo (drop_off/xd_drop_off) expected_date es el límite
// para despachar; para Flex (self_service) es el límite de entrega — en los dos casos, la
// fecha (no la hora) es el día en que el pedido tiene que salir de nuestro depósito.
export async function getShipmentSla(token, shipmentId) {
  return apiGet(`/shipments/${shipmentId}/sla`, token);
}

// Si el paquete ya salió físicamente de nuestro depósito — nunca lo marca un admin a mano, se
// deriva de los datos reales que ya trae el shipment de ML. Confirmado con pedidos reales:
// para Correo (drop_off/xd_drop_off) status se queda en "ready_to_ship" un buen rato, pero
// substatus pasa a "picked_up" apenas el cartero lo retira — date_shipped se queda en null
// (no sirve para Correo). Para Flex (self_service) es al revés: date_shipped se completa
// prácticamente apenas el mensajero lo retira. Se combinan las dos señales para que sirva para
// ambos canales sin distinguir logistic_type acá.
export function isShipmentDispatched(shipment) {
  if (!shipment) return false;
  if (shipment.status_history?.date_shipped) return true;
  if (shipment.substatus === "picked_up") return true;
  if (["shipped", "delivered", "not_delivered"].includes(shipment.status)) return true;
  return false;
}

export async function getItem(token, itemId) {
  return apiGet(`/items/${itemId}`, token);
}

// Domicilios cargados en la cuenta del vendedor — cada uno con "types" (puede incluir
// "shipping", que ML documenta como "la dirección desde la que se despachan los envíos") y su
// zip_code. Se usa para validar que el vendedor tenga cargado el depósito real de Ventaz.
export async function getUserAddresses(token, mlUserId) {
  const data = await apiGet(`/users/${mlUserId}/addresses`, token);
  return Array.isArray(data) ? data : [];
}

async function fetchListingPrices(token, siteId, { price, categoryId, listingTypeId, tags }) {
  const params = new URLSearchParams({ price, category_id: categoryId, listing_type_id: listingTypeId });
  if (tags) params.set("tags", tags);
  const data = await apiGet(`/sites/${siteId}/listing_prices?${params}`, token);
  return Array.isArray(data) ? data[0] : data;
}

// Campañas reales de cuotas de ML (confirmadas contra la documentación oficial de
// "Campaigns with installments for Marketplace"). Cada una es una combinación puntual de
// listing_type_id + tag — no existe un único endpoint que devuelva "todas las opciones de
// cuotas" de una, hay que pedir cada combinación por separado y quedarnos con las que
// respondan (no todas las categorías/cuentas tienen todas las campañas habilitadas).
//
// "cuota-simple-9"/"cuota-simple-12" ya no están en la documentación vigente (ML las recortó
// a 3/6 en 2025), pero algunas categorías puntuales (ML lo muestra en su propio flujo) todavía
// las ofrecen — se intentan igual, sin asumir que van a existir; si la cuenta/categoría no
// las tiene habilitadas, ML devuelve error y simplemente se excluyen de la lista.
const INSTALLMENT_CAMPAIGNS = [
  { id: "pcj",  label: "3 a 12 cuotas con interés bajo",           listingTypeId: "gold_special", tags: "pcj-co-funded",   badge: "Cuota promocionada", desc: "Tus compradores pagan hasta 70% menos del interés que cobran los bancos." },
  { id: "cs3",  label: "3 cuotas al mismo precio que publicaste",  listingTypeId: "gold_pro",      tags: "cuota-simple-3",  desc: null },
  { id: "cs6",  label: "6 cuotas al mismo precio que publicaste",  listingTypeId: "gold_pro",      tags: "cuota-simple-6",  badge: "Cuota recomendada", desc: "Esta opción aumenta tus posibilidades de vender." },
  { id: "cs9",  label: "9 cuotas al mismo precio que publicaste",  listingTypeId: "gold_pro",      tags: "cuota-simple-9",  desc: null },
  { id: "cs12", label: "12 cuotas al mismo precio que publicaste", listingTypeId: "gold_pro",      tags: "cuota-simple-12", desc: null },
];

// Desglose de comisión/costos de ML para un precio+categoría — lo mismo que ML muestra
// como "Recibís" al publicar. No hace falta el ítem creado, solo precio/categoría.
//
// includeInstallments=false evita las 5 consultas extra de campañas de cuotas cuando no hace
// falta mostrarlas (ej. la fila de cada publicación en el listado, que solo muestra cargo por
// vender/recibís) — pedirlas ahí sería tráfico desperdiciado contra la API de ML por cada
// publicación que tenga el vendedor.
export async function getListingFees(token, siteId, { price, categoryId, listingTypeId = "gold_special", includeInstallments = true }) {
  const [classic, ...campaignResults] = await Promise.all([
    fetchListingPrices(token, siteId, { price, categoryId, listingTypeId }),
    ...(includeInstallments ? INSTALLMENT_CAMPAIGNS.map(c =>
      fetchListingPrices(token, siteId, { price, categoryId, listingTypeId: c.listingTypeId, tags: c.tags }).catch(() => null)
    ) : []),
  ]);

  const saleFee = Number(classic?.sale_fee_amount || 0);

  const installmentOptions = campaignResults
    .map((result, i) => ({ campaign: INSTALLMENT_CAMPAIGNS[i], result }))
    .filter(({ result }) => result)
    .map(({ campaign, result }) => {
      const fee = Number(result.sale_fee_amount || 0);
      return {
        id:            campaign.id,
        label:         campaign.label,
        badge:         campaign.badge || null,
        desc:          campaign.desc || null,
        percentageFee: result.sale_fee_details?.percentage_fee ?? null,
        extraCost:     Math.max(0, fee - saleFee),
        saleFeeAmount: fee,
        netAmount:     Number(price) - fee,
        // Se devuelven para que el publish pueda mandar exactamente esto y activar la campaña
        // elegida en el ítem creado (POST /items con listing_type_id + tags).
        listingTypeId: campaign.listingTypeId,
        tags:          [campaign.tags],
      };
    });

  return {
    saleFeeAmount: saleFee,
    netAmount:     Number(price) - saleFee,
    listingTypeId: classic?.listing_type_name || listingTypeId,
    // Lista de campañas de cuotas realmente disponibles para esta cuenta/categoría/precio —
    // vacía si ML no habilitó ninguna (no se debe mostrar el selector en ese caso).
    installmentOptions,
  };
}

// Costo estimado de asumir el envío gratis para el comprador — mismo simulador que usa ML
// antes de publicar (GET /users/{user_id}/shipping_options/free). dimensions viene en el mismo
// formato "LxWxHxpeso" que ya arma mlListingService.estimateShippingDimensions().
export async function getShippingCostEstimate(token, mlUserId, { price, dimensions, listingTypeId = "gold_special" }) {
  const params = new URLSearchParams({
    dimensions, verbose: "true", item_price: price, listing_type_id: listingTypeId,
    mode: "me2", condition: "new", logistic_type: "drop_off",
  });
  const data = await apiGet(`/users/${mlUserId}/shipping_options/free?${params}`, token);
  // La respuesta real viene anidada en coverage.all_country.list_cost (no en un array "options"
  // ni en el objeto raíz como se asumía antes) — list_cost ya viene neto de cualquier descuento
  // de reputación (ML lo aplica del lado de ellos), no hace falta restar nada más.
  //
  // Importante: si list_cost no vino en la respuesta (undefined/null), NO se devuelve 0 — se
  // tira error para que el llamador lo trate como "no se pudo calcular" en vez de mostrar un
  // $0 que podría no ser real. Antes ese "?? 0" disimulaba cualquier parseo fallido como si el
  // envío realmente costara cero.
  const coverage = data?.coverage?.all_country || data?.coverage?.same_state || null;
  if (coverage?.list_cost == null) throw new Error("ML no devolvió una cotización de envío para este producto");
  return { cost: Number(coverage.list_cost) };
}

// Visitas + unidades vendidas + calidad de una publicación ya creada.
//
// El endpoint de visitas NO es /items/{id}/visits (esa ruta no existe en la API real de ML y
// siempre devolvía error, por eso las visitas quedaban en 0 para todas las publicaciones) — el
// endpoint correcto es /visits/items?ids={id}, que devuelve un objeto plano { "<item_id>": N }.
export async function getItemStats(token, itemId) {
  const [item, visitsData, healthData] = await Promise.all([
    apiGet(`/items/${itemId}?attributes=sold_quantity,price`, token),
    apiGet(`/visits/items?ids=${itemId}`, token).catch(() => null),
    apiGet(`/items/${itemId}/health`, token).catch(() => null),
  ]);
  return {
    soldQuantity: item?.sold_quantity || 0,
    // Precio real y actual de la publicación en ML — puede diferir del que Ventaz tiene
    // guardado en ml_listings.price (guardado al publicar/última vez que se tocó desde acá),
    // por ejemplo si el vendedor lo cambió directo en Mercado Libre.
    price: item?.price ?? null,
    visits: Number(visitsData?.[itemId] ?? 0),
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

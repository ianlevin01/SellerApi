import pool from "../database/db.js";
import * as repo from "./mlRepository.js";
import { getValidToken } from "./mlTokenService.js";
import * as svc from "./mlService.js";
import { signKey, getBuffer, uploadBuffer } from "../utils/s3Client.js";
import { getCotizacion } from "../payouts/payoutsRepository.js";
import { getSellerPlatformPct, calcShownCost } from "../utils/pricing.js";
import { getSellerPlan, getPlanMlListingLimit } from "../utils/sellerPlan.js";
import * as imagesService from "../images/imagesService.js";

// Override puntual de costo para cuentas específicas de ML — a diferencia del "costo real"
// (raw_cost_mode) de ecommerce, acá se muestra el costo con un margen fijo elegido por cuenta
// (ej. costo + 10%) en vez del margen por tramos normal. Null = comportamiento de siempre.
// Solo afecta lo que se MUESTRA al publicar/calcular, no lo que se cobra de deuda en una venta
// real (mlWebhookController.js sigue usando siempre el margen normal, para todos por igual).
async function getMlCostMarkupPct(sellerId) {
  const { rows } = await pool.query("SELECT ml_cost_markup_pct FROM sellers WHERE id = $1", [sellerId]);
  const pct = rows[0]?.ml_cost_markup_pct;
  return pct === null || pct === undefined ? null : Number(pct);
}

function shownCostWithOverride(costUsd, cotizacion, platformPct, planId, overridePct) {
  if (!costUsd) return 0;
  if (overridePct != null) return Math.round(Number(costUsd) * cotizacion * (1 + overridePct / 100));
  return calcShownCost(costUsd, cotizacion, platformPct, planId);
}

// Precio mínimo al que se puede publicar en ML — mismo costo que Ventaz necesita recuperar
// (ver mlWebhookController.js, misma fórmula). TODO: usar ventas reales del seller para el
// tier de platformPct en vez de asumir siempre el tier base.
// Pasa el plan del seller a calcShownCost — antes esto siempre usaba el factor de "inicial"
// (sin descuento) sin importar si el seller pagaba Pro/Max, que sí aplica ese descuento del
// lado de la tienda propia.
export async function getPriceFloor(sellerId, productId) {
  const { rows } = await pool.query(`SELECT costo_usd FROM products WHERE id = $1 AND active = true`, [productId]);
  if (!rows[0]) { const e = new Error("Producto no encontrado"); e.status = 404; throw e; }
  const [cotizacion, { plan_id }, markupPct] = await Promise.all([getCotizacion(), getSellerPlan(sellerId), getMlCostMarkupPct(sellerId)]);
  const platformPct = getSellerPlatformPct(0);
  return shownCostWithOverride(rows[0].costo_usd, cotizacion, platformPct, plan_id, markupPct);
}

// Peso/volumen para pedir el costo de envío en el wizard de publicar (el listado de productos
// de ecommerce que alimenta el catálogo de ML no trae estos dos campos).
export async function getProductShippingInfo(productId) {
  const { rows } = await pool.query(`SELECT weight_grams, volume_cm3 FROM products WHERE id = $1`, [productId]);
  return { weightGrams: Number(rows[0]?.weight_grams || 0), volumeCm3: Number(rows[0]?.volume_cm3 || 0) };
}

// Para la calculadora: buscar productos reales del catálogo por nombre y devolver ya
// resuelto el peso/volumen y el costo total (mismo cálculo que getPriceFloor), para que el
// vendedor solo tenga que cargar precio/envío/cuotas.
export async function searchProductsForCalculator(sellerId, search) {
  if (!search || search.trim().length < 2) return [];
  const [rows, cotizacion, { plan_id }, markupPct] = await Promise.all([
    repo.searchProductsForListing(search.trim()),
    getCotizacion(),
    getSellerPlan(sellerId),
    getMlCostMarkupPct(sellerId),
  ]);
  const platformPct = getSellerPlatformPct(0);
  return rows.map(p => ({
    id: p.id,
    name: p.name,
    weightGrams: Number(p.weight_grams || 0),
    volumeCm3:   Number(p.volume_cm3 || 0),
    priceFloor:  shownCostWithOverride(p.costo_usd, cotizacion, platformPct, plan_id, markupPct),
  }));
}

async function getProductForListing(productId) {
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.description, p.costo_usd, p.weight_grams, p.volume_cm3,
            GREATEST(0, COALESCE((SELECT SUM(s.quantity) FROM stock s WHERE s.product_id = p.id), 0)
              - COALESCE(p.stock_reserva, 0)) AS available_stock
     FROM products p WHERE p.id = $1 AND p.active = true`,
    [productId]
  );
  return rows[0] || null;
}

// ML pide "LxWxHcm,pesoGramos" — solo tenemos el volumen total, no los 3 lados por separado,
// así que aproximamos con un cubo (raíz cúbica del volumen). Es una aproximación, no exacta:
// si en algún momento se cargan largo/ancho/alto reales por producto, reemplazar esto por eso.
export function estimateShippingDimensions(weightGrams, volumeCm3) {
  if (!weightGrams || !volumeCm3) return null;
  const side = Math.max(1, Math.round(Math.cbrt(volumeCm3)));
  return `${side}x${side}x${side},${Math.round(weightGrams)}`;
}

// Sube una imagen nueva (elegida por el vendedor al momento de publicar, todavía no existe
// en S3) — primero intenta subirla directo a la API de Pictures de ML (rápido, sincrónico) y
// si falla (el endpoint /pictures/items/upload está bloqueado por PolicyAgent para algunas
// cuentas) cae a subirla a nuestro S3 y mandarla como URL firmada, mismo patrón híbrido que
// ya usa buildPictureRef() para las imágenes que el producto ya tenía guardadas.
// Devuelve una referencia lista para el array `pictures` de createItem: { id } o { source }.
export async function uploadPictureForSeller(sellerId, file) {
  const token = await getValidToken(sellerId);
  if (!token) { const e = new Error("Mercado Libre no está conectado"); e.status = 400; throw e; }
  try {
    const pictureId = await svc.uploadPicture(token, file.buffer, file.originalname, file.mimetype);
    return { ref: { id: pictureId } };
  } catch (err) {
    console.warn(`[ml] no se pudo subir imagen nueva directo a ML, cae a S3 + source URL:`, err.message);
    const key = `ml-uploads/${sellerId}/${Date.now()}-${file.originalname}`;
    const url = await uploadBuffer(key, file.buffer, file.mimetype);
    if (!url) { const e = new Error("No se pudo subir la imagen"); e.status = 502; throw e; }
    return { ref: { source: url } };
  }
}

function mimeFromKey(key) {
  const ext = key.split(".").pop()?.toLowerCase();
  return { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" }[ext] || "image/jpeg";
}

// Para cada imagen ya existente en S3, intenta subirla DIRECTO a ML (rápido, sincrónico,
// confirmado al toque) y solo si eso falla cae a mandarla como URL firmada (`source`) —
// ese segundo camino funciona, pero ML la descarga de forma asincrónica y puede quedar la
// publicación un rato en "picture_download_pending" hasta que la procesan del todo.
async function buildPictureRef(token, key) {
  try {
    const buffer = await getBuffer(key);
    const pictureId = await svc.uploadPicture(token, buffer, key.split("/").pop(), mimeFromKey(key));
    return { id: pictureId };
  } catch (err) {
    console.warn(`[ml] no se pudo subir "${key}" directo a ML, cae a source URL:`, err.message);
    const url = await signKey(key);
    return url ? { source: url } : null;
  }
}

// Depósito real de Ventaz — de donde salen físicamente los pedidos, sin importar qué vendedor
// aparece como dueño de la publicación en ML. Reusa el mismo CP que ya se usaba para cotizar
// Correo Argentino (MICORREO_ORIGIN_CP) en vez de duplicar el dato en otro lado. Si el depósito
// cambia de dirección en el futuro, estas dos variables (o el .env) son lo único que hay que tocar.
const WAREHOUSE_ZIP     = String(process.env.MICORREO_ORIGIN_CP || "1028").match(/\d{4}/)?.[0] || "1028";
const WAREHOUSE_ADDRESS = process.env.ML_WAREHOUSE_ADDRESS || "Pasteur 280, CABA";
// Página de ayuda oficial de ML sobre cómo gestionar domicilios de despacho — no encontramos
// (ni pudimos confirmar) una URL que lleve directo a la pantalla de edición, así que apuntamos
// acá en vez de inventar un link que capaz no exista.
const ML_ADDRESS_HELP_URL = "https://www.mercadolibre.com.ar/ayuda/28966";

function formatMlAddress(addr) {
  if (!addr) return null;
  const parts = [
    [addr.street_name, addr.street_number].filter(Boolean).join(" "),
    addr.city?.name || addr.city,
    addr.state?.name || addr.state,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : (addr.address || null);
}

// Compara el domicilio de despacho cargado en Mercado Libre contra el depósito real de Ventaz.
// Si ML no devuelve nada interpretable (cuenta nueva, cambio de formato de la API, etc.) queda
// "unknown" — preferimos no bloquear publicaciones por una duda nuestra, solo bloqueamos cuando
// estamos seguros de que el domicilio cargado NO es el correcto.
export async function getShippingAddressInfo(sellerId) {
  const token = await getValidToken(sellerId);
  if (!token) return { connected: false };
  const conn = await repo.getConnection(sellerId);
  if (!conn?.ml_user_id) return { connected: false };

  let addresses = null;
  try { addresses = await svc.getUserAddresses(token, conn.ml_user_id); } catch { addresses = null; }

  const base = { connected: true, warehouseAddress: WAREHOUSE_ADDRESS, changeAddressUrl: ML_ADDRESS_HELP_URL };
  if (!Array.isArray(addresses) || addresses.length === 0) return { ...base, unknown: true };

  const shippingAddr = addresses.find(a => a.types?.includes("shipping"))
    || addresses.find(a => a.types?.includes("default_selling_address"))
    || addresses[0];

  const currentZip = String(shippingAddr?.zip_code || "").match(/\d{4}/)?.[0] || null;
  if (!currentZip) return { ...base, unknown: true };

  return {
    ...base,
    unknown: false,
    valid: currentZip === WAREHOUSE_ZIP,
    currentZip,
    currentAddress: formatMlAddress(shippingAddr),
  };
}

// Usado antes de publicar — solo bloquea cuando getShippingAddressInfo está seguro de que el
// domicilio no coincide (valid === false); si quedó "unknown", deja publicar igual.
async function assertShippingAddressOk(sellerId) {
  const info = await getShippingAddressInfo(sellerId);
  if (info.connected && info.valid === false) {
    const e = new Error(`El domicilio de despacho de tu cuenta de Mercado Libre (${info.currentAddress || "sin datos"}) no coincide con el depósito de Ventaz (${info.warehouseAddress}). Actualizalo en Mercado Libre para poder publicar.`);
    e.status = 403;
    e.addressMismatch = true;
    e.currentAddress = info.currentAddress;
    e.warehouseAddress = info.warehouseAddress;
    e.changeAddressUrl = info.changeAddressUrl;
    throw e;
  }
}

// Límite de publicaciones activas según el plan — mismo patrón que el límite de tiendas en
// storeService.createPage. Compartido por publishProduct y publishCombo.
async function checkMlListingLimit(sellerId) {
  const { plan_id } = await getSellerPlan(sellerId);
  const listingLimit = getPlanMlListingLimit(plan_id);
  const activeCount = await repo.countActiveListings(sellerId);
  if (activeCount >= listingLimit) {
    const names = { inicial: "Plan Inicial", pro: "Plan Pro", max: "Plan Max" };
    const e = new Error(`Tu ${names[plan_id] || "plan actual"} permite hasta ${listingLimit} publicación${listingLimit === 1 ? "" : "es"} activa${listingLimit === 1 ? "" : "s"} en Mercado Libre. Actualizá tu plan para publicar más.`);
    e.status = 403;
    e.plan_limit = true;
    throw e;
  }
}

// Crea el ítem en ML traduciendo el error de "Mercado Envíos no activado" a algo accionable.
// Compartido por publishProduct y publishCombo.
// GTIN (código de barras) no viene marcado como "required" en la categoría — ML lo maneja
// como "conditional_required": si no se manda un GTIN real, hay que mandar en su lugar un
// atributo EMPTY_GTIN_REASON explicando por qué no hay ("Genérico"/"No registrado"/etc.).
// Como la gran mayoría de los productos del catálogo no tienen un código de barras real
// cargado, si el vendedor no completó GTIN a mano se lo suplimos automáticamente con el
// motivo — evita el rechazo "attributes [GTIN] are required" al publicar.
async function fillMissingGtinExemption(categoryId, attributes) {
  const hasAttr = id => attributes.some(a => a.id === id);
  if (hasAttr("GTIN") || hasAttr("EMPTY_GTIN_REASON")) return attributes;

  let categoryAttrs;
  try {
    // Sin filtrar a propósito — getCategoryAttributes (la que usa el wizard) excluye
    // EMPTY_GTIN_REASON explícitamente, así que nunca lo íbamos a encontrar ahí.
    categoryAttrs = await svc.getRawCategoryAttributes(categoryId);
  } catch {
    return attributes; // si no se puede consultar, seguimos sin tocar nada — que ML valide como siempre
  }
  const exemptionAttr = categoryAttrs.find(a => a.id === "EMPTY_GTIN_REASON");
  if (!exemptionAttr?.values?.length) return attributes; // esta categoría no pide GTIN, o no tiene motivos configurados

  // El texto real que usa ML hoy es "El producto no tiene código registrado" — "no tiene
  // c[oó]digo" cubre eso. Si ninguna variante matchea, mejor "Otra razón" (si existe) que caer
  // en el primer valor de la lista, que en varias categorías es algo específico como "es una
  // pieza artesanal" — un motivo incorrecto para casi cualquier producto del catálogo.
  const preferred = exemptionAttr.values.find(v => /gen[eé]ric|no tiene c[oó]digo|no registrad|sin c[oó]digo|not registered/i.test(v.name))
    || exemptionAttr.values.find(v => /otra raz[oó]n|other reason/i.test(v.name))
    || exemptionAttr.values[0];
  return [...attributes, { id: "EMPTY_GTIN_REASON", value_name: preferred.name }];
}

// Algunas categorías exigen que el propio vendedor declare las dimensiones del paquete
// (SELLER_PACKAGE_HEIGHT/WIDTH/LENGTH/WEIGHT) como atributos — separado del campo `dimensions`
// que ya mandamos para el cálculo de envío. Ya tenemos ese mismo dato (peso real + volumen
// aproximado a un cubo, igual que estimateShippingDimensions), así que se completa solo en vez
// de pedírselo al vendedor de nuevo.
function fillMissingPackageDimensions(attributes, weightGrams, volumeCm3) {
  const hasAttr = id => attributes.some(a => a.id === id);
  const needed = ["SELLER_PACKAGE_HEIGHT", "SELLER_PACKAGE_WIDTH", "SELLER_PACKAGE_LENGTH", "SELLER_PACKAGE_WEIGHT"]
    .filter(id => !hasAttr(id));
  if (needed.length === 0 || !weightGrams || !volumeCm3) return attributes;

  const side = Math.max(1, Math.round(Math.cbrt(volumeCm3)));
  const values = {
    SELLER_PACKAGE_HEIGHT: `${side} cm`,
    SELLER_PACKAGE_WIDTH:  `${side} cm`,
    SELLER_PACKAGE_LENGTH: `${side} cm`,
    SELLER_PACKAGE_WEIGHT: `${Math.round(weightGrams)} g`,
  };
  return [...attributes, ...needed.map(id => ({ id, value_name: values[id] }))];
}

// SALE_FORMAT = "Unidad" activa un requisito condicional de UNITS_PER_PACK que la categoría
// no marca como "required" de entrada (por eso queda en "características secundarias", no en
// las obligatorias) — si no se completa, ML rechaza la publicación con "Completá este campo
// porque completaste 'Unidad' en el campo 'Formato de venta'". Si vende por unidad, el
// paquete trae 1 unidad — se completa solo, mismo criterio que fillMissingGtinExemption.
function fillMissingUnitsPerPack(attributes) {
  const hasAttr = id => attributes.some(a => a.id === id);
  if (hasAttr("UNITS_PER_PACK")) return attributes;
  const saleFormat = attributes.find(a => a.id === "SALE_FORMAT");
  if (!saleFormat || !/^unidad$/i.test(String(saleFormat.value_name || "").trim())) return attributes;
  return [...attributes, { id: "UNITS_PER_PACK", value_name: "1" }];
}

// shippingFreeUsed viaja en el resultado porque el reintento de más abajo puede terminar
// publicando con un envío gratis distinto al que pidió el vendedor — sin esto, lo que
// guardamos en nuestra base quedaría desincronizado de lo que realmente tiene la publicación
// en Mercado Libre.
async function createMlItem(token, payload) {
  try {
    const item = await svc.createItem(token, payload);
    return { ...item, shippingFreeUsed: !!payload.shippingFree };
  } catch (err) {
    // ML manda un texto en inglés poco claro cuando la cuenta no tiene Mercado Envíos
    // activo (necesario porque siempre publicamos con shipping.mode = "me2") — lo
    // traducimos a algo que el vendedor pueda accionar directamente en su cuenta de ML.
    if (/mode me1|mercado.?envios/i.test(err.message)) {
      const e = new Error("Tu cuenta de Mercado Libre no tiene Mercado Envíos activado. Entrá a mercadolibre.com.ar → Configuración → Envíos y activalo antes de publicar.");
      e.status = 400;
      throw e;
    }
    // Para algunas categorías/precios, Mercado Libre exige envío gratis obligatorio (según
    // categoría y monto) — si el vendedor no lo tildó y ML lo rechaza por eso, reintentamos
    // una vez solos con envío gratis en vez de hacerle adivinar el motivo del error.
    if (!payload.shippingFree && /free.?shipping|envío gratis|shipping.*mandatory/i.test(err.message)) {
      const item = await svc.createItem(token, { ...payload, shippingFree: true });
      return { ...item, shippingFreeUsed: true };
    }

    // La campaña de cuotas elegida (tags) puede no estar habilitada para esta cuenta/categoría
    // puntual (ej. "Cuota Simple" exige producto de fabricación nacional) aunque el simulador
    // de precios la haya mostrado como disponible — mejor publicar sin la campaña que bloquear
    // la publicación entera por una preferencia de financiación.
    if (payload.tags?.length) {
      console.warn("[ml] no se pudo aplicar la campaña de cuotas, reintentando sin tags:", err.message);
      const item = await svc.createItem(token, { ...payload, tags: [] });
      return { ...item, shippingFreeUsed: !!payload.shippingFree, installmentTagsApplied: false };
    }

    // Cualquier atributo "conditional_required" que no supimos completar solos (GTIN vía
    // fillMissingGtinExemption, UNITS_PER_PACK vía fillMissingUnitsPerPack, etc. ya se resuelven
    // ANTES de llegar acá) — en vez de fallar en seco con un error sin salida, se le devuelve al
    // controller el atributo puntual que falta (con su definición real de ML: nombre, tipo,
    // opciones si es una lista) para que el wizard se lo pida al vendedor ahí mismo y reintente.
    // Sirve para cualquier categoría y cualquier atributo, no solo los que ya conocemos hoy.
    const missingMatch = err.message.match(/attributes?\s*\[([A-Z0-9_,\s]+)\]\s*(?:is|are)\s*required/i);
    if (missingMatch) {
      const attrId = missingMatch[1].split(",")[0].trim(); // si ML pide varios, resolvemos de a uno por reintento
      const categoryAttrs = await svc.getRawCategoryAttributes(payload.categoryId).catch(() => null);
      const attrDef = categoryAttrs?.find(a => a.id === attrId);
      if (attrDef) {
        const e = new Error(`Falta completar "${attrDef.name}" para esta categoría`);
        e.status = 422;
        e.missingAttribute = { id: attrDef.id, name: attrDef.name, valueType: attrDef.value_type, values: attrDef.values || null };
        throw e;
      }
    }

    throw err;
  }
}

// Publica un producto de Ventaz como un ítem nuevo en la cuenta de ML del seller.
// config: { mlCategoryId, attributes, price, shippingFree, title, description,
//           imageKeys (keys de S3 ya existentes que el vendedor dejó tildadas),
//           pictureRefs (subidas nuevas vía uploadPictureForSeller, ya listas como { id } o { source }) }
export async function publishProduct(sellerId, productId, config) {
  const token = await getValidToken(sellerId);
  if (!token) { const e = new Error("Mercado Libre no está conectado"); e.status = 400; throw e; }
  const conn = await repo.getConnection(sellerId);

  const product = await getProductForListing(productId);
  if (!product) { const e = new Error("Producto no encontrado"); e.status = 404; throw e; }
  if (!config.mlCategoryId) { const e = new Error("Falta la categoría de Mercado Libre"); e.status = 400; throw e; }
  if (!config.price || config.price <= 0) { const e = new Error("Falta el precio para Mercado Libre"); e.status = 400; throw e; }

  await checkMlListingLimit(sellerId);
  await assertShippingAddressOk(sellerId);

  const floor = await getPriceFloor(sellerId, productId);
  if (config.price < floor) {
    const e = new Error(`El precio no puede ser menor a $${Math.round(floor).toLocaleString("es-AR")} (costo total del producto)`);
    e.status = 400;
    throw e;
  }

  const existingPictureRefs = await Promise.all((config.imageKeys || []).map(key => buildPictureRef(token, key)));
  const pictures = [
    ...existingPictureRefs.filter(Boolean),
    ...(config.pictureRefs || []),
  ];
  if (pictures.length === 0) {
    const e = new Error("Seleccioná o subí al menos una imagen — Mercado Libre no permite publicar sin fotos");
    e.status = 400;
    throw e;
  }

  let attributes = await fillMissingGtinExemption(config.mlCategoryId, config.attributes || []);
  attributes = fillMissingPackageDimensions(attributes, product.weight_grams, product.volume_cm3);
  attributes = fillMissingUnitsPerPack(attributes);

  const item = await createMlItem(token, {
    title:       config.title?.trim() || product.name,
    categoryId:  config.mlCategoryId,
    price:       config.price,
    stock:       product.available_stock,
    description: config.description?.trim() || product.description,
    pictures,
    dimensions:  estimateShippingDimensions(product.weight_grams, product.volume_cm3),
    attributes,
    shippingFree: config.shippingFree,
    listingTypeId: config.listingTypeId || "gold_special",
    tags: config.installmentTags || [],
  });

  return repo.createListing(sellerId, {
    productId, mlItemId: item.mlItemId, permalink: item.permalink,
    status: "active", price: config.price, mlCategoryId: config.mlCategoryId,
    attributes, shippingFree: item.shippingFreeUsed,
    mlAccountId: conn?.ml_user_id, mlAccountNickname: conn?.ml_nickname,
  });
}

// ── Combos de ML ───────────────────────────────────────────────

// Crea el combo (agrupación de productos, todavía sin publicar) — el primer paso del flujo
// "Crear combo" en el Catálogo. products: [{ productId, quantity }].
export async function createCombo(sellerId, products) {
  if (!products?.length) { const e = new Error("El combo necesita al menos un producto"); e.status = 400; throw e; }
  const { rows } = await pool.query(
    `SELECT id, name FROM products WHERE id = ANY($1::uuid[]) AND active = true`,
    [products.map(p => p.productId)]
  );
  const byId = new Map(rows.map(r => [r.id, r.name]));
  const withNames = products.map(p => ({ ...p, name: byId.get(p.productId) || "Producto" }));
  const comboId = await repo.createCombo(sellerId, withNames);
  return { id: comboId };
}

// Detalle del combo para el modal de publicar — productos con nombre/cantidad/stock, y el
// piso de precio ya calculado con las cantidades actuales.
export async function getComboDetail(sellerId, comboId) {
  const owned = await repo.isComboOwned(comboId, sellerId);
  if (!owned) { const e = new Error("Combo no encontrado"); e.status = 404; throw e; }
  const [products, floor] = await Promise.all([
    repo.getComboProducts(comboId),
    getComboPriceFloor(sellerId, comboId),
  ]);
  return {
    id: comboId,
    products: products.map(p => ({
      productId: p.product_id, name: p.name, quantity: p.quantity, availableStock: Number(p.available_stock),
    })),
    priceFloor: floor,
  };
}

// Ajusta las cantidades de cada producto en el combo — se llama desde el modal cuando el
// vendedor cambia cuántas unidades de cada uno quiere incluir, antes de publicar.
export async function updateComboQuantities(sellerId, comboId, products) {
  const owned = await repo.isComboOwned(comboId, sellerId);
  if (!owned) { const e = new Error("Combo no encontrado"); e.status = 404; throw e; }
  if (!products?.length) { const e = new Error("El combo necesita al menos un producto"); e.status = 400; throw e; }

  const { rows } = await pool.query(
    `SELECT id, name FROM products WHERE id = ANY($1::uuid[]) AND active = true`,
    [products.map(p => p.productId)]
  );
  const byId = new Map(rows.map(r => [r.id, r.name]));
  const withNames = products.map(p => ({ ...p, name: byId.get(p.productId) || "Producto" }));

  await repo.updateComboProducts(comboId, withNames);
  return getComboDetail(sellerId, comboId);
}

export async function getComboPriceFloor(sellerId, comboId) {
  const products = await repo.getComboProducts(comboId);
  if (!products.length) { const e = new Error("Combo no encontrado"); e.status = 404; throw e; }
  const [cotizacion, { plan_id }, markupPct] = await Promise.all([getCotizacion(), getSellerPlan(sellerId), getMlCostMarkupPct(sellerId)]);
  const platformPct = getSellerPlatformPct(0);
  return products.reduce((sum, p) => sum + shownCostWithOverride(p.costo_usd, cotizacion, platformPct, plan_id, markupPct) * p.quantity, 0);
}

// Junta (sin repetir) todas las fotos de S3 que ya existen para cada producto del combo —
// el vendedor no elige fotos para un combo de ML, se arman solas con las de sus productos.
async function getImageKeysForCombo(sellerId, products) {
  const perProduct = await Promise.all(
    products.map(p => imagesService.getAllImagesForProduct(sellerId, p.product_id).catch(() => []))
  );
  const seen = new Set();
  const keys = [];
  for (const imgs of perProduct) {
    for (const img of imgs) {
      if (!seen.has(img.key)) { seen.add(img.key); keys.push(img.key); }
    }
  }
  return keys;
}

// Publica un combo como un solo ítem nuevo en ML — mismo flujo que publishProduct, pero
// agregando costos/peso/volumen/stock de todos los productos del combo, y con las fotos
// completadas automáticamente en vez de elegidas a mano.
export async function publishCombo(sellerId, comboId, config) {
  const token = await getValidToken(sellerId);
  if (!token) { const e = new Error("Mercado Libre no está conectado"); e.status = 400; throw e; }
  const conn = await repo.getConnection(sellerId);

  const owned = await repo.isComboOwned(comboId, sellerId);
  if (!owned) { const e = new Error("Combo no encontrado"); e.status = 404; throw e; }

  const products = await repo.getComboProducts(comboId);
  if (!products.length) { const e = new Error("El combo no tiene productos"); e.status = 400; throw e; }
  if (!config.mlCategoryId) { const e = new Error("Falta la categoría de Mercado Libre"); e.status = 400; throw e; }
  if (!config.price || config.price <= 0) { const e = new Error("Falta el precio para Mercado Libre"); e.status = 400; throw e; }

  await checkMlListingLimit(sellerId);
  await assertShippingAddressOk(sellerId);

  const floor = await getComboPriceFloor(sellerId, comboId);
  if (config.price < floor) {
    const e = new Error(`El precio no puede ser menor a $${Math.round(floor).toLocaleString("es-AR")} (costo total del combo)`);
    e.status = 400;
    throw e;
  }

  const imageKeys = await getImageKeysForCombo(sellerId, products);
  const existingPictureRefs = await Promise.all(imageKeys.map(key => buildPictureRef(token, key)));
  const pictures = existingPictureRefs.filter(Boolean);
  if (pictures.length === 0) {
    const e = new Error("Ninguno de los productos del combo tiene fotos disponibles — agregá fotos a los productos antes de publicar el combo");
    e.status = 400;
    throw e;
  }

  const totalWeight = products.reduce((sum, p) => sum + Number(p.weight_grams || 0) * p.quantity, 0);
  const totalVolume = products.reduce((sum, p) => sum + Number(p.volume_cm3 || 0) * p.quantity, 0);
  const availableStock = Math.min(...products.map(p => Math.floor(Number(p.available_stock) / p.quantity)));
  const comboName = await repo.getComboName(comboId);
  let attributes = await fillMissingGtinExemption(config.mlCategoryId, config.attributes || []);
  attributes = fillMissingPackageDimensions(attributes, totalWeight, totalVolume);
  attributes = fillMissingUnitsPerPack(attributes);

  const item = await createMlItem(token, {
    title:       config.title?.trim() || comboName,
    categoryId:  config.mlCategoryId,
    price:       config.price,
    stock:       Math.max(0, availableStock),
    description: config.description?.trim() || `Combo: ${comboName}`,
    pictures,
    dimensions:  estimateShippingDimensions(totalWeight, totalVolume),
    attributes,
    shippingFree: config.shippingFree,
    listingTypeId: config.listingTypeId || "gold_special",
    tags: config.installmentTags || [],
  });

  return repo.createListing(sellerId, {
    comboId, mlItemId: item.mlItemId, permalink: item.permalink,
    status: "active", price: config.price, mlCategoryId: config.mlCategoryId,
    attributes, shippingFree: item.shippingFreeUsed,
    mlAccountId: conn?.ml_user_id, mlAccountNickname: conn?.ml_nickname,
  });
}

// Empuja la cantidad disponible actual a ML — se usa desde el job de sync de stock para que
// la publicación no muestre más unidades de las que realmente quedan del pool compartido.
export async function syncStockToMl(sellerId, mlItemId, availableQuantity) {
  const token = await getValidToken(sellerId);
  if (!token) return;
  await svc.updateItem(token, mlItemId, { available_quantity: Math.max(0, Math.round(availableQuantity)) });
}

export async function pauseListing(sellerId, mlItemId, reason = "manual") {
  const token = await getValidToken(sellerId);
  if (!token) { const e = new Error("Mercado Libre no está conectado"); e.status = 400; throw e; }
  try {
    await svc.setItemStatus(token, mlItemId, "paused");
  } catch (err) {
    console.error(`[ml] no se pudo pausar ${mlItemId}:`, err.message);
    const e = new Error(`No se pudo pausar en Mercado Libre: ${err.message}`);
    e.status = 502;
    throw e;
  }
  await repo.updateListingStatus(mlItemId, "paused", reason);
}

export async function reactivateListing(sellerId, mlItemId) {
  const token = await getValidToken(sellerId);
  if (!token) { const e = new Error("Mercado Libre no está conectado"); e.status = 400; throw e; }
  try {
    await svc.setItemStatus(token, mlItemId, "active");
  } catch (err) {
    console.error(`[ml] no se pudo reactivar ${mlItemId}:`, err.message);
    const e = new Error(`No se pudo reactivar en Mercado Libre: ${err.message}`);
    e.status = 502;
    throw e;
  }
  await repo.updateListingStatus(mlItemId, "active", null);
}

// Pausa TODAS las publicaciones activas del seller — se usa cuando falla el cobro diario
// o cuando se queda sin stock físico.
export async function pauseAllSellerListings(sellerId, reason = "charge_failed") {
  const token = await getValidToken(sellerId);
  if (!token) return [];
  const itemIds = await repo.setAllListingsStatus(sellerId, "paused", reason);
  for (const mlItemId of itemIds) {
    await svc.setItemStatus(token, mlItemId, "paused").catch(err =>
      console.error(`[ml] no se pudo pausar ${mlItemId}:`, err.message));
  }
  return itemIds;
}

// Al vencer la prueba gratis o el plan pago — pausa solo las publicaciones que estén activas
// en este momento (deja intactas las ya pausadas por stock/cobro/manual, con su verdadero
// pause_reason, para no perder esa información al reactivar más adelante).
export async function pauseListingsForPlanExpiration(sellerId) {
  const token = await getValidToken(sellerId);
  if (!token) return [];
  const itemIds = await repo.pauseListingsForPlanExpiration(sellerId);
  for (const mlItemId of itemIds) {
    await svc.setItemStatus(token, mlItemId, "paused").catch(err =>
      console.error(`[ml] no se pudo pausar ${mlItemId} por vencimiento de plan:`, err.message));
  }
  return itemIds;
}

// Al pagar/renovar — reactiva únicamente las publicaciones que se habían pausado
// automáticamente por vencimiento de plan (pause_reason = 'plan_expired'). Es seguro llamarla
// siempre que el plan pasa a "active": si no hay nada pausado por esa razón, no hace nada.
export async function reactivateListingsAfterPlanRenewal(sellerId) {
  const token = await getValidToken(sellerId);
  if (!token) return [];
  const itemIds = await repo.reactivateListingsAfterPlanRenewal(sellerId);
  for (const mlItemId of itemIds) {
    await svc.setItemStatus(token, mlItemId, "active").catch(err =>
      console.error(`[ml] no se pudo reactivar ${mlItemId} tras renovar el plan:`, err.message));
  }
  return itemIds;
}

// Al cobrar bien la deuda obligatoria — reactiva únicamente las publicaciones que se habían
// pausado por cobro fallido (pause_reason = 'charge_failed'). Seguro de llamar siempre que se
// cobra bien: si no hay nada pausado por esa razón, no hace nada.
export async function reactivateListingsAfterChargeSuccess(sellerId) {
  const token = await getValidToken(sellerId);
  if (!token) return [];
  const itemIds = await repo.reactivateListingsAfterChargeSuccess(sellerId);
  for (const mlItemId of itemIds) {
    await svc.setItemStatus(token, mlItemId, "active").catch(err =>
      console.error(`[ml] no se pudo reactivar ${mlItemId} tras cobrar la deuda:`, err.message));
  }
  return itemIds;
}

export async function getListings(sellerId) {
  const listings = await repo.getListingsBySeller(sellerId);
  return Promise.all(listings.map(async l => ({
    ...l,
    image_url: l.image_key ? await signKey(l.image_key) : null,
  })));
}

export async function getSummary(sellerId) {
  return repo.getSummary(sellerId);
}

// Chequea si las fotos de una publicación ya terminaron de procesarse del lado de ML —
// cuando se suben como `source: url` (fallback del hybrid upload), ML las descarga de forma
// asíncrona y el ítem queda con sub_status "picture_download_pending" hasta que termina.
export async function getPictureStatus(sellerId, mlItemId) {
  const token = await getValidToken(sellerId);
  if (!token) { const e = new Error("Mercado Libre no está conectado"); e.status = 400; throw e; }
  const item = await svc.getItem(token, mlItemId);
  const subStatus = Array.isArray(item.sub_status) ? item.sub_status : [];
  return {
    pending: subStatus.includes("picture_download_pending"),
    thumbnail: item.thumbnail || item.pictures?.[0]?.secure_url || item.pictures?.[0]?.url || null,
  };
}

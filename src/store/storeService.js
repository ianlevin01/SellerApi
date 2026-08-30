// src/modules/store/storeService.js
import * as storeRepository        from "./storeRepository.js";
import * as authRepository         from "../auth/authRepository.js";
import * as shippingService        from "../shipping/shippingService.js";
import * as combosService          from "../combos/combosService.js";
import * as integrationsRepository from "../integrations/integrationsRepository.js";
import { signKey, signKeys }       from "../utils/s3Client.js";
import { transporter }       from "../config/mailer.js";
import { sendOrderReceived } from "../email/buyerEmails.js";
import { getSellerPlatformPct, calcShownCost } from "../utils/pricing.js";
import { getSellerPlan, getPlanStoreLimit }    from "../utils/sellerPlan.js";


function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function extractS3Key(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  // Si ya es una key de S3, la dejamos igual.
  if (!isHttpUrl(raw)) return raw;

  try {
    const parsed = new URL(raw);
    const bucket = process.env.AWS_BUCKET || process.env.S3_BUCKET;
    const host = parsed.hostname;
    const pathname = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));

    // Virtual-hosted style:
    // https://bucket.s3.sa-east-1.amazonaws.com/sellers/...
    if (bucket && (
      host === `${bucket}.s3.amazonaws.com` ||
      host.startsWith(`${bucket}.s3.`)
    )) {
      return pathname;
    }

    // Path-style:
    // https://s3.sa-east-1.amazonaws.com/bucket/sellers/...
    if (bucket && host.startsWith("s3.") && pathname.startsWith(`${bucket}/`)) {
      return pathname.slice(bucket.length + 1);
    }

    // URL externa: se conserva como URL.
    return raw;
  } catch {
    return raw;
  }
}

function normalizeStoreAssetValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const extracted = extractS3Key(raw);

  // URLs externas quedan como URL.
  if (isHttpUrl(extracted)) return extracted;

  // Keys de S3 se guardan como key estable.
  return extracted;
}

async function resolveStoreAssetUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const extracted = extractS3Key(raw);

  // URLs externas quedan como URL.
  if (isHttpUrl(extracted)) return extracted;

  // Si quedó guardado solo un nombre tipo "177.png", no lo devolvemos como URL local rota.
  if (!extracted.includes("/")) return "";

  // Keys de S3 se firman cada vez que se leen.
  return await signKey(extracted) || "";
}

async function withResolvedPageAssets(page) {
  if (!page) return page;
  return {
    ...page,
    logo_url:       await resolveStoreAssetUrl(page.logo_url),
    hero_image_url: await resolveStoreAssetUrl(page.hero_image_url),
  };
}


async function notifySellerNewOrder(sellerId, order, items) {
  try {
    const seller    = await authRepository.findSellerById(sellerId);
    const adminTo   = process.env.ADMIN_EMAIL || "somosventaz@gmail.com";
    const FROM_ADDR = process.env.SMTP_FROM   || "noreply@ventaz.online";
    const totalFmt  = `$${Number(order.total ?? 0).toLocaleString("es-AR")}`;

    const itemRows = items.map(i => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eee">${i.name}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${i.quantity}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">$${Number(i.unit_price).toLocaleString("es-AR")}</td>
      </tr>`).join("");

    const table = `
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <thead>
          <tr style="background:#f3f4f6">
            <th style="padding:8px;text-align:left">Producto</th>
            <th style="padding:8px;text-align:center">Cant.</th>
            <th style="padding:8px;text-align:right">Precio</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
      <p style="font-size:16px;font-weight:bold">Total: ${totalFmt}</p>`;

    // Notificación al vendedor
    if (seller?.email) {
      await transporter.sendMail({
        from: FROM_ADDR,
        to:      seller.email,
        subject: `Nueva venta #${order.numero} en tu tienda`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
            <h2 style="color:#6366f1">¡Tenés una nueva venta!</h2>
            <p>Se recibió el pedido <strong>#${order.numero}</strong>.</p>
            ${table}
            <p style="color:#666;font-size:13px">Revisá tu panel para ver el detalle completo.</p>
          </div>`,
      });
    }

    // Notificación al admin
    await transporter.sendMail({
      from: FROM_ADDR,
      to:      adminTo,
      subject: `Nueva venta #${order.numero} — ${seller?.name || seller?.email || sellerId}`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
          <h2 style="color:#6366f1">Nueva venta registrada</h2>
          <p>Pedido <strong>#${order.numero}</strong> de la tienda de
             <strong>${seller?.name || seller?.email || "—"}</strong>
             (${seller?.email || "—"}).</p>
          ${table}
        </div>`,
    });
  } catch {
    // Email failure must never break the order flow
  }
}


// ── Pages ─────────────────────────────────────────────────────

export async function getPages(sellerId) {
  return storeRepository.getPages(sellerId);
}

export async function createPage(sellerId, body) {
  const { page_name, slug, store_name, store_description, banner_color, pct_markup,
          tagline, whatsapp, instagram, facebook } = body;
  if (!slug || !/^[a-z0-9-]+$/.test(slug))
    throw { status: 400, message: "El slug solo puede contener letras minúsculas, números y guiones" };
  if (!store_name) throw { status: 400, message: "El nombre de la tienda es requerido" };

  // Verificar límite de tiendas según plan
  const { plan_id } = await getSellerPlan(sellerId);
  const limit = getPlanStoreLimit(plan_id);
  const existing = await storeRepository.getPages(sellerId);
  if (existing.length >= limit) {
    const names = { inicial: "Plan Inicial", pro: "Plan Pro", max: "Plan Max" };
    throw {
      status: 403,
      message: `Tu ${names[plan_id] || "plan actual"} permite hasta ${limit} tienda${limit === 1 ? "" : "s"}. Actualizá tu plan para crear más.`,
      plan_limit: true,
    };
  }

  try {
    return await storeRepository.createPage(sellerId, {
      page_name, slug, store_name, store_description, banner_color, pct_markup,
      tagline, whatsapp, instagram, facebook,
    });
  } catch (err) {
    if (err.code === "23505") throw { status: 409, message: "Ese slug ya está en uso" };
    throw err;
  }
}

export async function getPageConfig(pageId, sellerId) {
  const page = await storeRepository.getPageById(pageId, sellerId);
  if (!page) throw { status: 404, message: "Página no encontrada" };
  return await withResolvedPageAssets(page);
}

export async function updatePageConfig(pageId, sellerId, body) {
  if (body.pct_markup !== undefined && Number(body.pct_markup) < 0)
    throw { status: 400, message: "El markup no puede ser negativo" };
  const {
    slug,
    page_name, store_name, store_description, banner_color, pct_markup,
    tagline, whatsapp, instagram, facebook,
    logo_url, font_family, color_secondary, color_bg, color_text, featured_categories,
    card_border_radius, card_show_shadow,
    hero_headline, hero_image_url, promo_text, show_promo_bar,
    theme_config, costo_envio,
    favicon_url, og_image_url, meta_title, meta_description, tiktok, youtube,
  } = body;
  if (slug !== undefined) {
    if (!slug || !/^[a-z0-9-]+$/.test(slug))
      throw { status: 400, message: "El slug solo puede contener letras minúsculas, números y guiones" };
  }
  const updated = await storeRepository.updatePage(pageId, sellerId, {
    slug,
    page_name, store_name, store_description, banner_color, pct_markup,
    tagline, whatsapp, instagram, facebook,
    logo_url: normalizeStoreAssetValue(logo_url),
    font_family, color_secondary, color_bg, color_text, featured_categories,
    card_border_radius, card_show_shadow,
    hero_headline,
    hero_image_url: normalizeStoreAssetValue(hero_image_url),
    promo_text, show_promo_bar,
    theme_config, costo_envio,
    favicon_url: normalizeStoreAssetValue(favicon_url),
    og_image_url: normalizeStoreAssetValue(og_image_url),
    meta_title, meta_description, tiktok, youtube,
  });
  if (!updated) throw { status: 404, message: "Página no encontrada" };
  return await withResolvedPageAssets(updated);
}

export async function deletePage(pageId, sellerId) {
  const deleted = await storeRepository.deletePage(pageId, sellerId);
  if (!deleted) throw { status: 404, message: "Página no encontrada" };
}

// Legacy — returns first page for backward-compat
export async function getConfig(sellerId) {
  const config = await storeRepository.getConfig(sellerId);
  if (!config) throw { status: 404, message: "Configuración no encontrada" };
  return await withResolvedPageAssets(config);
}

// ── Pedidos con ganancia ──────────────────────────────────────

export async function getOrders(sellerId) {
  const orders = await storeRepository.getOrders(sellerId);

  // cotizacion solo se usa como fallback para órdenes sin unit_cost (anteriores a migración 018)
  let cotizacion = null;

  const withGanancia = await Promise.all(orders.map(async (order) => {
    const orderPlatformPct = getSellerPlatformPct(Number(order.total));
    let ganancia_producto  = 0;
    let costo_producto     = 0;

    for (const item of order.items) {
      if (!item.product_id) continue;

      let baseCost;
      if (item.unit_cost != null) {
        // Costo bloqueado al momento del checkout — mismo valor que usa payoutsService
        baseCost = Number(item.unit_cost);
      } else {
        // Fallback para órdenes anteriores a la migración 018
        if (cotizacion === null) cotizacion = await storeRepository.getCotizacion();
        const costUsd = await storeRepository.getCostUsdForProduct(item.product_id);
        baseCost = calcShownCost(costUsd, cotizacion, 30);
      }

      // adjustedCost = baseCost × (1 + platformPct/100) / 1.30
      // baseCost fue calculado con tier 30%; ajustamos al tier real del pedido
      const adjustedCost = baseCost * (1 + orderPlatformPct / 100) / 1.30;
      costo_producto += adjustedCost * item.quantity;
      const diferencia = Number(item.unit_price) - adjustedCost;
      if (diferencia > 0) ganancia_producto += diferencia * item.quantity;
    }

    // Comisión real de Mercado Libre (sale_fee por unidad, ya guardada por el webhook al
    // procesar la venta) y costo real de envío gratis que absorbió el vendedor en ESTE pedido
    // (list_cost - lo que pagó el comprador) — ambos son datos reales de la venta, no estimaciones.
    const comisionMl = order.items.reduce(
      (sum, item) => sum + Number(item.ml_sale_fee || 0) * Number(item.quantity || 0), 0
    );
    const envioGratisMl = Number(order.ml_shipping_cost || 0);
    const freeShippingAbsorbed = Number(order.free_shipping_absorbed || 0);
    const ganancia_vendedor = Math.max(
      0, ganancia_producto - freeShippingAbsorbed - comisionMl - envioGratisMl
    );

    return { ...order, ganancia_vendedor, costo_producto, comision_ml: comisionMl, envio_gratis_ml: envioGratisMl };
  }));

  return withGanancia;
}

// ── Tienda pública ────────────────────────────────────────────

export async function getPublicStore(slug) {
  const page = await storeRepository.getPageBySlug(slug);
  if (!page) throw { status: 404, message: "Tienda no encontrada" };

  const [products, cotizacion, discountConfig, allTiers, combos, integrationConfigs, { plan_id }] = await Promise.all([
    storeRepository.getPublicProducts(page.id, page.seller_id),
    storeRepository.getCotizacion(),
    storeRepository.getDiscountConfig(page.id),
    storeRepository.getAllDiscountTiers(page.id),
    combosService.getPublicCombos(page.id).catch(() => []),
    integrationsRepository.getPublicConfigs(page.id).catch(() => ({})),
    getSellerPlan(page.seller_id),
  ]);
  const platformPct = 30; // siempre base 30% para mostrar precio_1 (el tier aplica al calcular ganancias, no precios)

  const productsWithPrice = await Promise.all(products.map(async p => {
    const precio_1     = p.costo_usd ? calcShownCost(p.costo_usd, cotizacion, platformPct, plan_id) : null;
    const precio_venta = p.custom_price ? Number(p.custom_price) : precio_1;
    return {
      ...p,
      images:       await signKeys(p.images || []),
      precio_1,
      precio_venta,
    };
  }));

  const discount = {
    enabled_quantity: discountConfig?.enabled_quantity ?? false,
    enabled_price:    discountConfig?.enabled_price    ?? false,
    quantity_tiers:   allTiers.filter(t => t.discount_type === "quantity"),
    price_tiers:      allTiers.filter(t => t.discount_type === "price"),
  };

  const publicPage = await withResolvedPageAssets(page);
  return { page: publicPage, products: productsWithPrice, discount, combos, integrations: integrationConfigs };
}

// ── Descuentos progresivos ────────────────────────────────────

export async function getDiscounts(pageId, sellerId) {
  const page = await storeRepository.getPageById(pageId, sellerId);
  if (!page) throw { status: 404, message: "Página no encontrada" };
  const [config, allTiers] = await Promise.all([
    storeRepository.getDiscountConfigByPage(pageId),
    storeRepository.getAllDiscountTiersByPage(pageId),
  ]);
  return {
    enabled_quantity: config?.enabled_quantity ?? false,
    enabled_price:    config?.enabled_price    ?? false,
    quantity_tiers:   allTiers.filter(t => t.discount_type === "quantity"),
    price_tiers:      allTiers.filter(t => t.discount_type === "price"),
  };
}

function validateTiers(tiers, label) {
  for (const t of tiers) {
    if (Number(t.threshold) <= 0)
      throw { status: 400, message: `${label}: los umbrales deben ser mayores a 0` };
    if (Number(t.discount_pct) <= 0 || Number(t.discount_pct) > 100)
      throw { status: 400, message: `${label}: los descuentos deben estar entre 1 y 100` };
  }
  const sorted = [...tiers].sort((a, b) => Number(a.threshold) - Number(b.threshold));
  for (let i = 1; i < sorted.length; i++) {
    if (Number(sorted[i].discount_pct) <= Number(sorted[i - 1].discount_pct))
      throw { status: 400, message: `${label}: los niveles deben ser mayores a medida que sube el umbral` };
  }
  return sorted;
}

export async function updateDiscounts(pageId, sellerId, body) {
  const page = await storeRepository.getPageById(pageId, sellerId);
  if (!page) throw { status: 404, message: "Página no encontrada" };

  const { enabled_quantity, enabled_price, quantity_tiers = [], price_tiers = [] } = body;
  const sortedQty   = validateTiers(quantity_tiers, "Por cantidad");
  const sortedPrice = validateTiers(price_tiers,    "Por monto");

  const config = await storeRepository.upsertDiscountConfigByPage(pageId, {
    enabled_quantity: Boolean(enabled_quantity),
    enabled_price:    Boolean(enabled_price),
  });

  await Promise.all([
    storeRepository.replaceDiscountTiersByPage(pageId, "quantity", sortedQty),
    storeRepository.replaceDiscountTiersByPage(pageId, "price",    sortedPrice),
  ]);

  const allTiers = await storeRepository.getAllDiscountTiersByPage(pageId);
  return {
    enabled_quantity: config.enabled_quantity,
    enabled_price:    config.enabled_price,
    quantity_tiers:   allTiers.filter(t => t.discount_type === "quantity"),
    price_tiers:      allTiers.filter(t => t.discount_type === "price"),
  };
}

// ── Checkout público (crea el pedido y devuelve URL de pago si está configurada) ──

export async function createCheckout(slug, { customer, items }) {
  if (!items || items.length === 0)
    throw { status: 400, message: "El carrito está vacío" };
  if (!customer?.name)
    throw { status: 400, message: "El nombre del comprador es requerido" };
  if (!customer?.email?.trim())
    throw { status: 400, message: "El email del comprador es requerido" };

  const page = await storeRepository.getPageBySlug(slug);
  if (!page) throw { status: 404, message: "Tienda no encontrada" };

  const cotizacion  = await storeRepository.getCotizacion();
  const platformPct = 30; // precio base siempre con tier 30%

  let realTotal = 0;
  const pricedItems = [];
  for (const item of items) {
    const [costUsd, sellerProduct] = await Promise.all([
      storeRepository.getCostUsdForProduct(item.product_id),
      storeRepository.getSellerProduct(page.id, item.product_id),
    ]);
    const precioBase  = calcShownCost(costUsd, cotizacion, platformPct);
    const unitPrice   = sellerProduct?.custom_price ? Number(sellerProduct.custom_price) : precioBase;
    realTotal += unitPrice * item.quantity;
    pricedItems.push({ product_id: item.product_id, name: item.name, quantity: item.quantity, unit_price: unitPrice });
  }

  const order = await storeRepository.createPublicOrder({
    customer, total: realTotal, seller_id: page.seller_id,
  });
  await storeRepository.createOrderItems(order.id, pricedItems);
  notifySellerNewOrder(page.seller_id, { ...order, total: realTotal }, pricedItems);
  sendOrderReceived({ customer, order: { ...order, total: realTotal }, items: pricedItems });

  return { numero: order.numero, order_number: order.numero };
}

// ── Envíos (MiCorreo) ─────────────────────────────────────────

export async function getShippingRates(slug, cp) {
  const page = await storeRepository.getPageBySlug(slug);
  if (!page) throw { status: 404, message: "Tienda no encontrada" };
  return shippingService.getRates(cp);
}

export async function getShippingAgencies(slug, province, cp) {
  const page = await storeRepository.getPageBySlug(slug);
  if (!page) throw { status: 404, message: "Tienda no encontrada" };
  const all = await shippingService.getAgencies(province);
  if (!cp) return all;
  const userCp = parseInt(cp, 10);
  if (isNaN(userCp)) return all;
  const nearby = all.filter(a => {
    const aCp = parseInt(a.cp, 10);
    return !isNaN(aCp) && Math.abs(aCp - userCp) <= 1;
  });
;
  return nearby.length > 0 ? nearby : all;
}

export async function setProductPrice(pageId, sellerId, productId, customPrice) {
  const page = await storeRepository.getPageById(pageId, sellerId);
  if (!page) throw { status: 404, message: "Página no encontrada" };

  const [cotizacion, costUsd, { plan_id }] = await Promise.all([
    storeRepository.getCotizacion(),
    storeRepository.getCostUsdForProduct(productId),
    getSellerPlan(sellerId),
  ]);
  const precio1 = calcShownCost(costUsd, cotizacion, 30, plan_id);

  if (precio1 > 0 && Number(customPrice) < precio1 - 0.01)
    throw { status: 400, message: `El precio mínimo para este producto es $${Math.ceil(precio1)}` };

  await storeRepository.setProductPrice(pageId, productId, Number(customPrice));
  return { message: "Precio actualizado", precio_1: precio1 };
}

const FREE_SHIPPING_MIN_MARGIN = 15000;

export async function setProductPromo(pageId, sellerId, productId, promoPrice, promoEnabled) {
  const page = await storeRepository.getPageById(pageId, sellerId);
  if (!page) throw { status: 404, message: "Página no encontrada" };

  if (promoEnabled) {
    if (!promoPrice || Number(promoPrice) <= 0)
      throw { status: 400, message: "El precio promocional debe ser mayor a 0" };

    const [cotizacion, costUsd, sellerProduct, { plan_id }] = await Promise.all([
      storeRepository.getCotizacion(),
      storeRepository.getCostUsdForProduct(productId),
      storeRepository.getSellerProduct(pageId, productId),
      getSellerPlan(sellerId),
    ]);
    const precio1 = calcShownCost(costUsd, cotizacion, 30, plan_id);

    if (precio1 > 0 && Number(promoPrice) < precio1 - 0.01)
      throw { status: 400, message: `El precio promo mínimo es $${Math.ceil(precio1)}` };

    const salePrice = sellerProduct?.custom_price;
    if (salePrice && Number(promoPrice) >= Number(salePrice) - 0.01)
      throw { status: 400, message: "El precio promo debe ser menor al precio de venta" };

    if (sellerProduct?.free_shipping && precio1 > 0) {
      const minRequired = Math.ceil(precio1 + FREE_SHIPPING_MIN_MARGIN);
      if (Number(promoPrice) < minRequired)
        throw {
          status: 400,
          message: `El precio promocional es insuficiente para mantener el envío gratis. El precio mínimo es $${minRequired.toLocaleString("es-AR")}.`,
        };
    }
  }

  await storeRepository.updateProductPromo(pageId, productId, promoEnabled ? Number(promoPrice) : null, Boolean(promoEnabled));
  return { message: "Promoción actualizada" };
}

export async function getMyTierInfo() {
  const cotizacion = await storeRepository.getCotizacion();
  return { cotizacion };
}

export async function createPublicOrder(slug, { customer, items }) {
  if (!items || items.length === 0)
    throw { status: 400, message: "El carrito está vacío" };
  if (!customer?.name)
    throw { status: 400, message: "El nombre del comprador es requerido" };

  const page = await storeRepository.getPageBySlug(slug);
  if (!page) throw { status: 404, message: "Tienda no encontrada" };

  const cotizacion = await storeRepository.getCotizacion();

  let realTotal = 0;
  const pricedItems = [];
  for (const item of items) {
    const [costUsd, sellerProduct] = await Promise.all([
      storeRepository.getCostUsdForProduct(item.product_id),
      storeRepository.getSellerProduct(page.id, item.product_id),
    ]);
    const precioBase  = calcShownCost(costUsd, cotizacion, 30);
    const unitPrice   = sellerProduct?.custom_price ? Number(sellerProduct.custom_price) : precioBase;
    realTotal += unitPrice * item.quantity;
    pricedItems.push({ product_id: item.product_id, name: item.name, quantity: item.quantity, unit_price: unitPrice });
  }

  const order = await storeRepository.createPublicOrder({
    customer, total: realTotal, seller_id: page.seller_id,
  });
  await storeRepository.createOrderItems(order.id, pricedItems);
  notifySellerNewOrder(page.seller_id, { ...order, total: realTotal }, pricedItems);
  sendOrderReceived({ customer, order: { ...order, total: realTotal }, items: pricedItems });

  return { message: "Pedido recibido", numero: order.numero };
}

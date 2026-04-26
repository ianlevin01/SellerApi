// src/modules/store/storeService.js
import * as storeRepository from "./storeRepository.js";
import * as authRepository  from "../auth/authRepository.js";
import { signKeys }         from "../utils/s3Client.js";
import { transporter }      from "../config/mailer.js";

async function notifySellerNewOrder(sellerId, order, items) {
  try {
    const seller = await authRepository.findSellerById(sellerId);
    if (!seller?.email) return;

    const itemRows = items
      .map(i => `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eee">${i.name}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${i.quantity}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">$${Number(i.unit_price).toLocaleString("es-AR")}</td>
      </tr>`)
      .join("");

    await transporter.sendMail({
      from:    process.env.SMTP_FROM || "noreply@tudominio.com",
      to:      seller.email,
      subject: `Nueva venta #${order.numero} en tu tienda`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
          <h2 style="color:#6366f1">¡Tenés una nueva venta!</h2>
          <p>Se recibió el pedido <strong>#${order.numero}</strong>.</p>
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
          <p style="font-size:16px;font-weight:bold">
            Total: $${Number(order.total ?? 0).toLocaleString("es-AR")}
          </p>
          <p style="color:#666;font-size:13px">Revisá tu panel para ver el detalle completo del pedido.</p>
        </div>
      `,
    });
  } catch {
    // Email failure must never break the order flow
  }
}

function getPctGanancia(total) {
  if (total >= 1000000) return 0.60;
  if (total >= 500000)  return 0.50;
  if (total >= 100000)  return 0.45;
  return 0.40;
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
  return page;
}

export async function updatePageConfig(pageId, sellerId, body) {
  if (body.pct_markup !== undefined && Number(body.pct_markup) < 0)
    throw { status: 400, message: "El markup no puede ser negativo" };
  const {
    page_name, store_name, store_description, banner_color, pct_markup,
    tagline, whatsapp, instagram, facebook,
    logo_url, font_family, color_secondary, color_bg, color_text, featured_categories,
  } = body;
  const updated = await storeRepository.updatePage(pageId, sellerId, {
    page_name, store_name, store_description, banner_color, pct_markup,
    tagline, whatsapp, instagram, facebook,
    logo_url, font_family, color_secondary, color_bg, color_text, featured_categories,
  });
  if (!updated) throw { status: 404, message: "Página no encontrada" };
  return updated;
}

export async function deletePage(pageId, sellerId) {
  const pages = await storeRepository.getPages(sellerId);
  if (pages.length <= 1) throw { status: 400, message: "No podés eliminar tu única tienda" };
  const deleted = await storeRepository.deletePage(pageId, sellerId);
  if (!deleted) throw { status: 404, message: "Página no encontrada" };
}

// Legacy — returns first page for backward-compat
export async function getConfig(sellerId) {
  const config = await storeRepository.getConfig(sellerId);
  if (!config) throw { status: 404, message: "Configuración no encontrada" };
  return config;
}

// ── Pedidos con ganancia ──────────────────────────────────────

export async function getOrders(sellerId) {
  const orders = await storeRepository.getOrders(sellerId);

  const cotizacion = await storeRepository.getCotizacion();
  const withGanancia = await Promise.all(orders.map(async (order) => {
    let ganancia_bruta = 0;

    for (const item of order.items) {
      if (!item.product_id) continue;
      const costUsd    = await storeRepository.getCostUsdForProduct(item.product_id);
      const base120    = costUsd * cotizacion * 1.20;
      const diferencia = Number(item.unit_price) - base120;
      if (diferencia > 0) ganancia_bruta += diferencia * item.quantity;
    }

    const total        = Number(order.total);
    const pct_ganancia = getPctGanancia(total);

    return {
      ...order,
      ganancia_bruta,
      pct_ganancia,
      ganancia_vendedor: ganancia_bruta * pct_ganancia,
    };
  }));

  return withGanancia;
}

// ── Tienda pública ────────────────────────────────────────────

export async function getPublicStore(slug) {
  const page = await storeRepository.getPageBySlug(slug);
  if (!page) throw { status: 404, message: "Tienda no encontrada" };

  const [products, cotizacion, discountConfig, allTiers] = await Promise.all([
    storeRepository.getPublicProducts(page.id, page.seller_id),
    storeRepository.getCotizacion(),
    storeRepository.getDiscountConfig(page.id),
    storeRepository.getAllDiscountTiers(page.id),
  ]);
  const pct = Number(page.pct_markup) / 100;

  const productsWithPrice = await Promise.all(products.map(async p => {
    const precio_1    = p.costo_usd ? Number(p.costo_usd) * cotizacion * 1.44 : null;
    const precio_venta = precio_1 ? Number((precio_1 * (1 + pct)).toFixed(2)) : null;
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

  return { page, products: productsWithPrice, discount };
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

export async function createCheckout(slug, { customer, items, total }) {
  if (!items || items.length === 0)
    throw { status: 400, message: "El carrito está vacío" };
  if (!customer?.name)
    throw { status: 400, message: "El nombre del comprador es requerido" };
  if (!customer?.email?.trim())
    throw { status: 400, message: "El email del comprador es requerido" };

  const page = await storeRepository.getPageBySlug(slug);
  if (!page) throw { status: 404, message: "Tienda no encontrada" };

  const order = await storeRepository.createPublicOrder({
    customer, total, seller_id: page.seller_id,
  });
  await storeRepository.createOrderItems(order.id, items);
  notifySellerNewOrder(page.seller_id, { ...order, total }, items);

  // TODO: Integrar LemonSqueezy cuando esté configurado.
  // const checkout_url = await createLemonSqueezyCheckout({ order, items, customer });
  // if (checkout_url) return { numero: order.numero, checkout_url };

  return { numero: order.numero, order_number: order.numero };
}

export async function createPublicOrder(slug, { customer, items, total }) {
  if (!items || items.length === 0)
    throw { status: 400, message: "El carrito está vacío" };
  if (!customer?.name)
    throw { status: 400, message: "El nombre del comprador es requerido" };

  const page = await storeRepository.getPageBySlug(slug);
  if (!page) throw { status: 404, message: "Tienda no encontrada" };

  const order = await storeRepository.createPublicOrder({
    customer, total, seller_id: page.seller_id,
  });
  await storeRepository.createOrderItems(order.id, items);
  notifySellerNewOrder(page.seller_id, { ...order, total }, items);

  return { message: "Pedido recibido", numero: order.numero };
}

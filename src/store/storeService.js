// src/modules/store/storeService.js
import * as storeRepository from "./storeRepository.js";
import { signKeys } from "../utils/s3Client.js";

function getPctGanancia(total) {
  if (total >= 1000000) return 0.60;
  if (total >= 500000)  return 0.50;
  if (total >= 100000)  return 0.45;
  return 0.40;
}

// ── Config ────────────────────────────────────────────────────

export async function getConfig(sellerId) {
  const config = await storeRepository.getConfig(sellerId);
  if (!config) throw { status: 404, message: "Configuración no encontrada" };
  return config;
}

export async function updateConfig(sellerId, body) {
  if (body.pct_markup !== undefined && Number(body.pct_markup) < 0)
    throw { status: 400, message: "El markup no puede ser negativo" };
  // Pass only known fields to the repository
  const { store_name, store_description, banner_color, pct_markup, tagline, whatsapp, instagram, facebook } = body;
  return storeRepository.updateConfig(sellerId, { store_name, store_description, banner_color, pct_markup, tagline, whatsapp, instagram, facebook });
}

// ── Pedidos con ganancia ──────────────────────────────────────

export async function getOrders(sellerId) {
  const orders = await storeRepository.getOrders(sellerId);

  const withGanancia = await Promise.all(orders.map(async (order) => {
    let ganancia_bruta = 0;

    for (const item of order.items) {
      if (!item.product_id) continue;
      const precio1    = await storeRepository.getPrecio1ForProduct(item.product_id);
      const diferencia = Number(item.unit_price) - precio1;
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

  const [products, cotizacion, discountConfig, discountTiers] = await Promise.all([
    storeRepository.getPublicProducts(page.seller_id),
    storeRepository.getCotizacion(),
    storeRepository.getDiscountConfig(page.seller_id),
    storeRepository.getDiscountTiers(page.seller_id),
  ]);
  const pct = Number(page.pct_markup) / 100;

  const productsWithPrice = await Promise.all(products.map(async p => {
    const precio_ars = p.precio_1 ? Number(p.precio_1) * cotizacion : null;
    return {
      ...p,
      images:       await signKeys(p.images || []),
      precio_1:     precio_ars,
      precio_venta: precio_ars ? Number((precio_ars * (1 + pct)).toFixed(2)) : null,
    };
  }));

  const discount = discountConfig
    ? { ...discountConfig, tiers: discountTiers }
    : { enabled: false, discount_type: "quantity", min_profit_pct: 10, tiers: [] };

  return { page, products: productsWithPrice, discount };
}

// ── Descuentos progresivos ────────────────────────────────────

export async function getDiscounts(sellerId) {
  const [config, tiers] = await Promise.all([
    storeRepository.getDiscountConfig(sellerId),
    storeRepository.getDiscountTiers(sellerId),
  ]);
  return {
    enabled:        config?.enabled        ?? false,
    discount_type:  config?.discount_type  ?? "quantity",
    min_profit_pct: config?.min_profit_pct ?? 10,
    tiers,
  };
}

export async function updateDiscounts(sellerId, body) {
  const { enabled, discount_type, min_profit_pct, tiers = [] } = body;

  if (!["quantity", "price"].includes(discount_type))
    throw { status: 400, message: "discount_type debe ser 'quantity' o 'price'" };

  const pct = Number(min_profit_pct);
  if (isNaN(pct) || pct < 0 || pct > 100)
    throw { status: 400, message: "min_profit_pct debe estar entre 0 y 100" };

  for (const t of tiers) {
    if (Number(t.threshold) <= 0)
      throw { status: 400, message: "Los umbrales deben ser mayores a 0" };
    if (Number(t.discount_pct) <= 0 || Number(t.discount_pct) > 100)
      throw { status: 400, message: "Los descuentos deben estar entre 1 y 100" };
  }

  // Verify tiers are strictly ascending in both threshold and discount_pct
  const sorted = [...tiers].sort((a, b) => Number(a.threshold) - Number(b.threshold));
  for (let i = 1; i < sorted.length; i++) {
    if (Number(sorted[i].discount_pct) <= Number(sorted[i - 1].discount_pct))
      throw { status: 400, message: "Los niveles de descuento deben ser mayores a medida que sube el umbral" };
  }

  const config = await storeRepository.upsertDiscountConfig(sellerId, {
    enabled: Boolean(enabled),
    discount_type,
    min_profit_pct: pct,
  });

  await storeRepository.replaceDiscountTiers(sellerId, sorted);
  const updatedTiers = await storeRepository.getDiscountTiers(sellerId);

  return { ...config, tiers: updatedTiers };
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

  return { message: "Pedido recibido", numero: order.numero };
}

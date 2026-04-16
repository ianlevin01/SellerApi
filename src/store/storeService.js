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
  return storeRepository.updateConfig(sellerId, body);
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

  const [products, cotizacion] = await Promise.all([
    storeRepository.getPublicProducts(page.seller_id),
    storeRepository.getCotizacion(),
  ]);
  const pct = Number(page.pct_markup) / 100;

  const productsWithPrice = await Promise.all(products.map(async p => {
    const precio_ars = p.precio_1 ? Number(p.precio_1) * cotizacion : null;
    return {
      ...p,
      images: await signKeys(p.images || []),
      precio_1:     precio_ars,
      precio_venta: precio_ars ? (precio_ars * (1 + pct)).toFixed(2) : null,
    };
  }));

  return { page, products: productsWithPrice };
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

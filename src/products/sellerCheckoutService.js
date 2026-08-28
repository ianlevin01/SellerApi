import { MercadoPagoConfig, Preference } from "mercadopago";
import * as productsRepo from "./productsRepository.js";
import * as purchaseRepo from "../purchase/purchaseRepository.js";
import { getCotizacion } from "../store/storeRepository.js";
import { getSellerPlan } from "../utils/sellerPlan.js";
import { getCostOverrides, calcPrecio1 } from "./productsService.js";
import { getRates, getAgencies } from "../shipping/shippingService.js";
import { sendSellerOrderPending } from "../email/buyerEmails.js";

const mp = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

const PANEL_URL   = process.env.SELLER_APP_URL || "https://panel.ventaz.com.ar";
const isPanelLocal = PANEL_URL.includes("localhost");

// ─── Cotización de envío ─────────────────────────────────────────────────────

export async function getShippingQuote(postalCode) {
  return getRates(postalCode);
}

export async function getShippingAgencies(province, cp) {
  const all = await getAgencies(province);
  if (!cp) return all;
  const userCp = parseInt(cp, 10);
  if (isNaN(userCp)) return all;
  const nearby = all.filter(a => {
    const aCp = parseInt(a.cp, 10);
    return !isNaN(aCp) && Math.abs(aCp - userCp) <= 1;
  });
  return nearby.length > 0 ? nearby : all;
}

// ─── Solicitar producto (1 unidad para el vendedor) ──────────────────────────

export async function requestProductCheckout(sellerId, productId, shipping, pageId) {
  // shipping = { type: "pickup" | "sucursal" | "domicilio", postal_code?, rate? }
  // rate = { code, name, price } — ya calculado en el frontend desde /shipping-quote

  const [product, seller, cotizacion, { plan_id }, overrides] = await Promise.all([
    productsRepo.getProductForCheckout(productId),
    productsRepo.getSellerInfo(sellerId),
    getCotizacion(),
    getSellerPlan(sellerId),
    getCostOverrides(sellerId),
  ]);

  if (!product) {
    const err = new Error("Producto no encontrado");
    err.status = 404;
    throw err;
  }

  const precio1 = calcPrecio1(product.costo_usd, cotizacion, plan_id, overrides) || 0;
  const shippingAmount = (shipping.type === "pickup" || !shipping.rate) ? 0 : Number(shipping.rate?.price || 0);
  const total = precio1 + shippingAmount;

  const customer = {
    name:          seller.name,
    email:         seller.email,
    phone:         null,
    city:          shipping.city    || null,
    postal_code:   shipping.postal_code || null,
    street:        shipping.street  || null,
    street_number: shipping.street_number || null,
  };

  const order = await purchaseRepo.createWebOrder({
    customer,
    items: [{
      product_id:        product.id,
      name:              product.name,
      quantity:          1,
      unit_price_final:  precio1,
      unit_price_base:   precio1,
    }],
    total,
    seller_id:              sellerId,
    shipping_amount:        shippingAmount,
    free_shipping_absorbed: 0,
    order_type:             "seller_request",
  });

  sendSellerOrderPending({
    sellerId,
    order,
    items: [{ name: product.name, quantity: 1, unit_price_final: precio1, free_shipping: false }],
    shippingAmount,
  }).catch(() => {});

  // MercadoPago preference
  const mpItems = [
    { id: String(product.id), title: product.name, quantity: 1, unit_price: Number(precio1.toFixed(2)), currency_id: "ARS" },
  ];
  if (shippingAmount > 0) {
    mpItems.push({ id: "shipping", title: shipping.rate?.name || "Envío", quantity: 1, unit_price: Number(shippingAmount.toFixed(2)), currency_id: "ARS" });
  }

  const preference = new Preference(mp);
  const mpResp = await preference.create({
    body: {
      external_reference: String(order.id),
      binary_mode: true,
      statement_descriptor: "VENTAZ",
      items: mpItems,
      payer: { name: seller.name, email: seller.email },
      back_urls: {
        success: pageId
          ? `${PANEL_URL}/pages/${pageId}/products?confirmed=seller_request`
          : `${PANEL_URL}/pages?confirmed=seller_request`,
        failure: pageId ? `${PANEL_URL}/pages/${pageId}/products` : `${PANEL_URL}/pages`,
        pending: pageId ? `${PANEL_URL}/pages/${pageId}/products` : `${PANEL_URL}/pages`,
      },
      ...(!isPanelLocal ? { auto_return: "approved" } : {}),
      ...(process.env.BACKEND_URL ? {
        notification_url: `${process.env.BACKEND_URL}/seller/purchase/webhook`,
      } : {}),
    },
  });

  return { checkout_url: mpResp.init_point, order_number: order.numero };
}

// ─── Reservar stock ──────────────────────────────────────────────────────────

export async function reserveStockCheckout(sellerId, productId, quantity, pageId) {
  if (!quantity || quantity < 1) {
    const err = new Error("La cantidad debe ser mayor a 0");
    err.status = 400;
    throw err;
  }

  const [product, seller, cotizacion, { plan_id }, overrides] = await Promise.all([
    productsRepo.getProductForCheckout(productId),
    productsRepo.getSellerInfo(sellerId),
    getCotizacion(),
    getSellerPlan(sellerId),
    getCostOverrides(sellerId),
  ]);

  if (!product) {
    const err = new Error("Producto no encontrado");
    err.status = 404;
    throw err;
  }

  if (quantity > product.available_for_reserve) {
    const err = new Error(
      `Solo hay ${product.available_for_reserve} unidad${product.available_for_reserve !== 1 ? "es" : ""} disponibles para reservar`
    );
    err.status = 400;
    throw err;
  }

  const precio1 = (calcPrecio1(product.costo_usd, cotizacion, plan_id, overrides) || 0);
  const total   = precio1 * quantity;

  const customer = {
    name:  seller.name,
    email: seller.email,
    phone: null,
    city:  null,
  };

  const order = await purchaseRepo.createWebOrder({
    customer,
    items: [{
      product_id:        product.id,
      name:              product.name,
      quantity,
      unit_price_final:  precio1,
      unit_price_base:   precio1,
    }],
    total,
    seller_id:              sellerId,
    shipping_amount:        0,
    free_shipping_absorbed: 0,
    order_type:             "stock_reserve",
  });

  const preference = new Preference(mp);
  const mpResp = await preference.create({
    body: {
      external_reference: String(order.id),
      binary_mode: true,
      statement_descriptor: "VENTAZ",
      items: [{
        id:          String(product.id),
        title:       product.name,
        quantity,
        unit_price:  Number(precio1.toFixed(2)),
        currency_id: "ARS",
      }],
      payer: { name: seller.name, email: seller.email },
      back_urls: {
        success: pageId
          ? `${PANEL_URL}/pages/${pageId}/products?confirmed=stock_reserve`
          : `${PANEL_URL}/pages?confirmed=stock_reserve`,
        failure: pageId ? `${PANEL_URL}/pages/${pageId}/products` : `${PANEL_URL}/pages`,
        pending: pageId ? `${PANEL_URL}/pages/${pageId}/products` : `${PANEL_URL}/pages`,
      },
      ...(!isPanelLocal ? { auto_return: "approved" } : {}),
      ...(process.env.BACKEND_URL ? {
        notification_url: `${process.env.BACKEND_URL}/seller/purchase/webhook`,
      } : {}),
    },
  });

  return { checkout_url: mpResp.init_point, order_number: order.numero };
}

export async function getMyReserves(sellerId) {
  return productsRepo.getSellerStockReserves(sellerId);
}

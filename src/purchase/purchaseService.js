// src/modules/checkout/checkoutService.js
import { MercadoPagoConfig, Preference, Payment } from "mercadopago";
import * as repo               from "./purchaseRepository.js";
import * as shippingService    from "../shipping/shippingService.js";
import * as shippingRepository from "../shipping/shippingRepository.js";
import * as payoutsService     from "../payouts/payoutsService.js";

const mp = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Aplica markup del revendedor y descuentos por precio/cantidad.
 * Devuelve { enrichedItems, subtotal, discountTotal, total }
 */
function buildPricedItems({ products, items, markup, discountConfig, discountTiers, cotizacion }) {
  const MARKUP_MINIMO = 1.44; // 144% sobre costo_usd

  let enrichedItems = [];
  let subtotal = 0;

  for (const item of items) {
    const product = products.find(p => p.id === item.product_id);
    if (!product) continue;

    // Precio base = costo_usd * cotizacion * 1.44 (piso mínimo)
    const costoEnPesos = Number(product.costo_usd) * Number(cotizacion);
    const precioBase   = costoEnPesos * MARKUP_MINIMO;

    // Precio de venta: el que fijó el revendedor, o el mínimo si no fijó nada
    const precioConMarkup = product.custom_price
      ? Number(product.custom_price)
      : precioBase;

    enrichedItems.push({
      product_id:         product.id,
      name:               product.name,
      quantity:           item.quantity,
      unit_price_base:    precioBase,
      unit_price_markup:  precioConMarkup,
      unit_price_final:   precioConMarkup, // se ajusta abajo si hay descuento
    });

    subtotal += precioConMarkup * item.quantity;
  }

  let discountTotal = 0;

  if (discountConfig) {
    let applicableTier = null;

    // Descuento por monto — usa solo tiers de tipo "price"
    if (discountConfig.enabled_price) {
      const priceTiers = discountTiers.filter(t => t.discount_type === "price");
      applicableTier = priceTiers
        .filter(t => subtotal >= Number(t.threshold))
        .sort((a, b) => b.threshold - a.threshold)[0] ?? null;
    }

    // Descuento por cantidad — usa solo tiers de tipo "quantity", gana el mayor %
    if (discountConfig.enabled_quantity) {
      const totalQty   = enrichedItems.reduce((acc, i) => acc + i.quantity, 0);
      const qtyTiers   = discountTiers.filter(t => t.discount_type === "quantity");
      const tierByQty  = qtyTiers
        .filter(t => totalQty >= Number(t.threshold))
        .sort((a, b) => b.threshold - a.threshold)[0] ?? null;

      if (
        tierByQty &&
        (!applicableTier || Number(tierByQty.discount_pct) > Number(applicableTier.discount_pct))
      ) {
        applicableTier = tierByQty;
      }
    }

    if (applicableTier) {
      const pct = Number(applicableTier.discount_pct) / 100;
      for (const item of enrichedItems) {
        const discount        = item.unit_price_markup * pct;
        item.unit_price_final = item.unit_price_markup - discount;
        discountTotal        += discount * item.quantity;
      }
    }
  }

  const total = enrichedItems.reduce(
    (acc, i) => acc + i.unit_price_final * i.quantity,
    0
  );

  return { enrichedItems, subtotal, discountTotal, total };
}

// ─── createCheckout ──────────────────────────────────────────────────────────

export async function createCheckout({ slug, customer, items, shipping, seller }) {
  // 1. Traer la página del revendedor
  const page = await repo.getPageBySlug(slug);
  if (!page) {
    const err = new Error("Página no encontrada");
    err.status = 404;
    throw err;
  }

  // 2. Cotización del dólar (negocio fijo del sistema)
  const cotizacion = await repo.getCotizacionDolar();

  // 3. Productos
  const products = await repo.getProductsByIds(
    items.map(i => i.product_id),
    page.id
  );

  if (!products.length) {
    const err = new Error("No se encontraron productos válidos");
    err.status = 400;
    throw err;
  }

  // 4. Config de descuentos del revendedor
  const discountConfig = await repo.getSellerDiscountConfig(page.id);
  const discountTiers  = await repo.getSellerDiscountTiers(page.id);

  // 5. Calcular precios de productos
  const { enrichedItems, total: productsTotal } = buildPricedItems({
    products,
    items,
    discountConfig,
    discountTiers,
    cotizacion,
  });

  // 6. Sumar costo de envío al total
  const shippingAmount = shipping ? Number(shipping.amount || 0) : 0;
  const total          = productsTotal + shippingAmount;

  // 7. Crear la orden en la BD (estado pendiente hasta que MP confirme)
  const order = await repo.createWebOrder({
    customer,
    items:           enrichedItems,
    total,
    seller_id:       page.seller_id,
    shipping_amount: shippingAmount,
  });

  // 8. Guardar detalle de envío y registrar en MiCorreo (en background, no bloquea)
  if (shipping) {
    shippingRepository.saveOrderShipping(order.id, shipping)
      .catch(err => console.error("[shipping] saveOrderShipping error:", err.message));

    shippingService.importShipment({
      orderId:     order.id,
      orderNumero: order.numero,
      customer,
      shipping,
      total,
    }).then(result => {
      if (result?.tracking_code) {
        // Update tracking code once we have it
        shippingRepository.saveOrderShipping(order.id, shipping, result.tracking_code)
          .catch(() => {});
      }
    }).catch(err => console.error("[shipping] importShipment error:", err.message));
  }

  // 9. Crear preferencia de Mercado Pago
  const front   = process.env.FRONTEND_URL ?? "";
  const isLocal = front.includes("localhost") || front.includes("127.0.0.1");

  const mpItems = enrichedItems.map(i => ({
    id:          String(i.product_id),
    title:       i.name,
    quantity:    i.quantity,
    unit_price:  Number(i.unit_price_final.toFixed(2)),
    currency_id: "ARS",
  }));

  // Add shipping as a separate line item in the MP preference
  if (shippingAmount > 0) {
    mpItems.push({
      id:          "shipping",
      title:       shipping.service_name || "Envío",
      quantity:    1,
      unit_price:  Number(shippingAmount.toFixed(2)),
      currency_id: "ARS",
    });
  }

  const preferenceBody = {
    external_reference: String(order.id),
    items: mpItems,
    payer: {
      name:  customer.name || `${customer.firstName || ""} ${customer.lastName || ""}`.trim(),
      email: customer.email,
      phone: { number: (customer.phone ?? "").replace(/\D/g, "") || "0" },
    },
    ...(front && !isLocal ? {
      back_urls: {
        success: `${front}/?shop=${slug}`,
        failure: `${front}/?shop=${slug}`,
        pending: `${front}/?shop=${slug}`,
      },
      auto_return: "approved",
    } : {}),
    // notification_url desactivado temporalmente para diagnóstico
    // ...(!isLocal && process.env.BACKEND_URL ? {
    //   notification_url: `${process.env.BACKEND_URL}/seller/purchase/webhook`,
    // } : {}),
  };


  const preference = new Preference(mp);
  const mpResponse = await preference.create({ body: preferenceBody });

  return {
    checkout_url: mpResponse.init_point,
    order_number: order.numero,
  };
}

// ─── confirmPayment (llamado desde el front al volver del checkout de MP) ────

const MP_STATUS_MAP = {
  approved:   "paid",
  rejected:   "rejected",
  cancelled:  "cancelled",
  refunded:   "refunded",
  in_process: "pending",
  pending:    "pending",
};

export async function confirmPayment(paymentId) {
  const paymentClient = new Payment(mp);
  let payment;
  try {
    payment = await paymentClient.get({ id: paymentId });
  } catch (err) {
    const e = new Error("Pago no encontrado en MercadoPago");
    e.status = 404;
    throw e;
  }

  const newStatus = MP_STATUS_MAP[payment.status];
  if (newStatus && payment.external_reference) {
    await repo.updateOrderStatus(payment.external_reference, newStatus, String(payment.id));

    if (newStatus === "paid") {
      payoutsService.createEarningForOrder(payment.external_reference)
        .catch(err => console.error("[payouts] createEarning error:", err.message));
    }
  }

  return {
    status:     payment.status,
    order_id:   payment.external_reference,
    payment_id: String(payment.id),
  };
}

// ─── handleWebhook ───────────────────────────────────────────────────────────

const MP_STATUS_MAP_WEBHOOK = {
  approved:   "paid",
  rejected:   "rejected",
  cancelled:  "cancelled",
  refunded:   "refunded",
  in_process: "pending",
  pending:    "pending",
};

export async function handleWebhook(query, body) {
  const topic = query.topic || body.type;
  const id    = query.id    || body.data?.id;

  if (topic !== "payment" || !id) return;

  const paymentClient = new Payment(mp);
  let payment;
  try {
    payment = await paymentClient.get({ id });
  } catch (err) {
    // En sandbox MP puede notificar IDs que todavía no existen (preflight).
    console.warn(`[webhook] no se pudo obtener payment ${id}:`, err?.message);
    return;
  }

  const newStatus = MP_STATUS_MAP_WEBHOOK[payment.status];
  if (!newStatus) {
    console.log(`[webhook] payment ${id} status="${payment.status}" ignorado`);
    return;
  }

  const orderId = payment.external_reference;
  console.log(`[webhook] payment ${id} → ${payment.status} → order ${orderId}`);

  await repo.updateOrderStatus(orderId, newStatus, String(payment.id));

  if (newStatus === "paid") {
    payoutsService.createEarningForOrder(orderId)
      .catch(err => console.error("[payouts] createEarning error:", err.message));
  }
}
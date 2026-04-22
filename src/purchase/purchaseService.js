// src/modules/checkout/checkoutService.js
import mercadopago from "mercadopago";
import * as checkoutRepository from "./checkoutRepository.js";

mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN
});

const repo = require("../repositories/checkout.repository");

async function createCheckout({ slug, customer, items }) {
  // 1. Traer página + seller
  const page = await repo.getPageBySlug(slug);
  if (!page) throw new Error("Página no encontrada");

  // 2. Traer productos
  const products = await repo.getProductsByIds(
    items.map(i => i.product_id),
    page.id
  );

  // 3. Config descuentos
  const discountConfig = await repo.getSellerDiscountConfig(page.id);
  const discountTiers  = await repo.getSellerDiscountTiers(page.id);

  let subtotal = 0;
  let enrichedItems = [];

  for (const item of items) {
    const product = products.find(p => p.id === item.product_id);
    if (!product) continue;

    let basePrice = Number(product.price);

    // 👉 markup del seller
    const markup = Number(page.pct_markup || 0);
    let priceWithMarkup = basePrice * (1 + markup);

    enrichedItems.push({
      product_id: product.id,
      name: product.name,
      quantity: item.quantity,
      unit_price_base: basePrice,
      unit_price_markup: priceWithMarkup,
      unit_price_final: priceWithMarkup, // se ajusta después
    });

    subtotal += priceWithMarkup * item.quantity;
  }

  let discountTotal = 0;

  // 👉 aplicar descuentos si están activos
  if (discountConfig?.enabled) {
    let applicableTier = null;

    if (discountConfig.enabled_price) {
      applicableTier = discountTiers
        .filter(t => subtotal >= Number(t.threshold))
        .sort((a, b) => b.threshold - a.threshold)[0];
    }

    if (discountConfig.enabled_quantity) {
      const totalQty = enrichedItems.reduce((acc, i) => acc + i.quantity, 0);

      const tierByQty = discountTiers
        .filter(t => totalQty >= Number(t.threshold))
        .sort((a, b) => b.threshold - a.threshold)[0];

      if (!applicableTier || (tierByQty && tierByQty.threshold > applicableTier.threshold)) {
        applicableTier = tierByQty;
      }
    }

    if (applicableTier) {
      const pct = Number(applicableTier.discount_pct) / 100;

      for (const item of enrichedItems) {
        const discount = item.unit_price_markup * pct;
        item.unit_price_final = item.unit_price_markup - discount;

        discountTotal += discount * item.quantity;
      }
    }
  }

  const total = enrichedItems.reduce(
    (acc, i) => acc + i.unit_price_final * i.quantity,
    0
  );

  // 4. Crear orden
  const order = await repo.createWebOrder({
    customer,
    items: enrichedItems,
    total,
    seller_id: page.seller_id,
    negocio_id: page.negocio_id,
  });

  // 5. Crear checkout externo (LemonSqueezy)
  const checkout_url = await createLemonCheckout({
    items: enrichedItems,
    total,
    orderId: order.id,
  });

  return {
    checkout_url,
    order_number: order.numero,
  };
}

module.exports = {
  createCheckout,
};

export async function handleWebhook(body) {
  if (body.type !== "payment") return;

  const paymentId = body.data.id;

  const payment = await mercadopago.payment.findById(paymentId);

  if (payment.body.status !== "approved") return;

  const metadata = payment.body.metadata;

  // 1. Guardar orden
  await checkoutRepository.createOrder({
    seller_id: metadata.seller_id,
    items: metadata.items,
    payment_id: paymentId,
    total: payment.body.transaction_amount
  });

  // 2. Calcular comisiones
  await checkoutRepository.registerCommission(metadata.seller_id, payment.body.transaction_amount);
}
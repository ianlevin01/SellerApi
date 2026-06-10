import * as repo from "./adminRepository.js";
import { getAnalyticsAdmin } from "../store/analyticsRepository.js";
import { notifySellerCvuVerified, notifySellerPayoutTransferred, sendOrderPackaged, sendOrderShipped } from "../email/buyerEmails.js";

export async function getDashboard() {
  const [stats, recentOrders, recentSellers] = await Promise.all([
    repo.getDashboardStats(),
    repo.getRecentOrders(20),
    repo.getRecentSellers(10),
  ]);
  return { stats, recentOrders, recentSellers };
}

export async function getMetrics() {
  return repo.getMetrics();
}

export async function getSellers() {
  return repo.getAllSellers();
}

export async function getSellerDetail(id) {
  const seller = await repo.getSellerById(id);
  if (!seller) throw { status: 404, message: "Vendedor no encontrado" };
  const [pages, orders, earnings] = await Promise.all([
    repo.getSellerPages(id),
    repo.getSellerOrders(id),
    repo.getSellerEarnings(id),
  ]);
  return { seller, pages, orders, earnings };
}

export async function blockSeller(id, block) {
  const seller = await repo.blockSeller(id, !block);
  if (!seller) throw { status: 404, message: "Vendedor no encontrado" };
  return seller;
}

export async function verifyCvu(id, verified) {
  const seller = await repo.verifyCvu(id, verified);
  if (!seller) throw { status: 404, message: "Vendedor no encontrado" };
  if (verified) {
    notifySellerCvuVerified({
      sellerEmail: seller.email,
      sellerName:  seller.name,
      cvu:         seller.cvu,
      alias:       seller.cvu_alias,
      holderName:  seller.cvu_holder_name,
    }).catch(() => {});
  }
  return seller;
}

export async function getOrders(filters) {
  return repo.getAllOrders(filters);
}

export async function packOrder(orderId) {
  const order = await repo.markOrderPackaged(orderId);
  if (!order) throw { status: 404, message: "Pedido no encontrado o no está en estado pagado" };
  sendOrderPackaged(order).catch(() => {});
  return { message: "Pedido marcado como empaquetado" };
}

export async function shipOrderDirect(orderId, trackingCode) {
  const order = await repo.markOrderShippedDirect(orderId, trackingCode || null);
  if (!order) throw { status: 404, message: "Pedido no encontrado o ya fue enviado" };
  sendOrderShipped({
    customerEmail:  order.customer_email,
    customerName:   order.customer_name,
    orderNumero:    order.numero,
    trackingNumber: trackingCode || null,
  }).catch(() => {});
  return { message: "Pedido marcado como enviado" };
}

export async function getEarnings(status) {
  return repo.getAllEarnings(status || null);
}

export async function approveEarning(id) {
  const earning = await repo.approveEarning(id);
  if (!earning) throw { status: 404, message: "Ganancia no encontrada o ya aprobada" };
  return earning;
}

export async function getPayouts(status) {
  return repo.getAllPayouts(status || null);
}

export async function markPayoutTransferred(id) {
  const payout = await repo.markPayoutTransferred(id);
  if (!payout) throw { status: 404, message: "Pago no encontrado o ya transferido" };
  notifySellerPayoutTransferred(payout.seller_email, payout.seller_name, payout.amount, payout.cvu);
  return payout;
}

export async function getProducts() {
  return repo.getAllProducts();
}

export async function updateProductCost(productId, cost) {
  if (!cost || Number(cost) <= 0) throw { status: 400, message: "Costo inválido" };
  await repo.updateProductCost(productId, Number(cost));
  return { message: "Costo actualizado" };
}

export async function getPageAnalytics(pageId, from, to) {
  return getAnalyticsAdmin(pageId, from, to);
}

export async function getPriceConfig() {
  return repo.getPriceConfig();
}

export async function updatePriceConfig(cotizacion) {
  if (!cotizacion || Number(cotizacion) <= 0) throw { status: 400, message: "Cotización inválida" };
  await repo.updatePriceConfig(Number(cotizacion));
  return { message: "Cotización actualizada" };
}

export async function getSalesReport(filters) {
  return repo.getSalesReport(filters);
}

export async function updateProductDimensions(productId, body) {
  const { weight_grams, volume_cm3, dims_reviewed } = body;
  if (weight_grams !== undefined && (isNaN(Number(weight_grams)) || Number(weight_grams) < 0))
    throw { status: 400, message: "weight_grams inválido" };
  if (volume_cm3 !== undefined && (isNaN(Number(volume_cm3)) || Number(volume_cm3) < 0))
    throw { status: 400, message: "volume_cm3 inválido" };
  await repo.updateProductDimensions(productId, {
    weight_grams:  weight_grams  !== undefined ? Number(weight_grams)  : undefined,
    volume_cm3:    volume_cm3    !== undefined ? Number(volume_cm3)    : undefined,
    dims_reviewed: dims_reviewed !== undefined ? Boolean(dims_reviewed) : undefined,
  });
  return { message: "Dimensiones actualizadas" };
}

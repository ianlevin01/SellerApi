import * as repo from "./adminRepository.js";
import { getAnalyticsAdmin } from "../store/analyticsRepository.js";
import { notifySellerCvuVerified, notifySellerPayoutTransferred, sendOrderPackaged, sendOrderPackagedToSeller, sendOrderShipped, sendOrderShippedToSeller } from "../email/buyerEmails.js";
import * as mlWalletService from "../ml/mlWalletService.js";
import { getPlanMlGraceHours } from "../utils/sellerPlan.js";

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
  const [pages, orders, earnings, stockReserves] = await Promise.all([
    repo.getSellerPages(id),
    repo.getSellerOrders(id),
    repo.getSellerEarnings(id),
    repo.getSellerStockReserves(id),
  ]);
  return { seller, pages, orders, earnings, stockReserves };
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

export async function packOrder(orderId, trackingCode) {
  const order = await repo.markOrderPackaged(orderId, trackingCode || null);
  if (!order) throw { status: 404, message: "Pedido no encontrado o no está en estado pagado" };
  sendOrderPackaged(order).catch(() => {});
  sendOrderPackagedToSeller(order.id).catch(() => {});
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
  sendOrderShippedToSeller(order.id, trackingCode || null).catch(() => {});
  return { message: "Pedido marcado como enviado" };
}

export async function getEarnings(status) {
  return repo.getAllEarnings(status || null);
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

// Marca cada venta con `shippable` — el bloqueo es por CUENTA, no por pedido puntual: si el
// vendedor tiene ALGUNA venta pendiente que ya superó su ventana de gracia sin cobrarse, se
// bloquean TODAS sus ventas pendientes (incluso las recientes, todavía dentro de su propia
// ventana) — mismo criterio que mlLabelService.getLabelsPdfForOrders, para que la pestaña de
// acá coincida exactamente con lo que después se puede/no se puede imprimir.
export async function getMlSales(filters) {
  const rows = await repo.getMlSales(filters);

  const matureBySeller = new Set();
  const now = Date.now();
  for (const row of rows) {
    if (row.ml_charge_status !== "pending") continue;
    const graceHours = getPlanMlGraceHours(row.plan_id);
    const ageHours = (now - new Date(row.created_at).getTime()) / 3600000;
    if (ageHours > graceHours) matureBySeller.add(row.seller_id);
  }

  return rows.map(row => ({
    ...row,
    shippable: row.ml_charge_status === "charged" || !matureBySeller.has(row.seller_id),
  }));
}

// Pestaña "Cobros y deudas" — un renglón por vendedor conectado a ML con saldo/deuda/tarjeta.
export async function getMlWalletOverview() {
  const [sellers, pendingOrders] = await Promise.all([
    repo.getMlWalletSellers(),
    repo.getMlPendingOrdersAll(),
  ]);

  const bySeller = new Map();
  for (const o of pendingOrders) {
    if (!bySeller.has(o.seller_id)) bySeller.set(o.seller_id, []);
    bySeller.get(o.seller_id).push(o);
  }

  const now = Date.now();
  return sellers.map(s => {
    const orders = bySeller.get(s.seller_id) || [];
    const graceHours = getPlanMlGraceHours(s.plan_id);
    const cutoffMs = now - graceHours * 3600000;
    const pendingDebt = orders.reduce((sum, o) => sum + Number(o.ml_cost_amount || 0), 0);
    const blockedDebt = orders
      .filter(o => new Date(o.created_at).getTime() <= cutoffMs)
      .reduce((sum, o) => sum + Number(o.ml_cost_amount || 0), 0);
    return {
      sellerId: s.seller_id, name: s.name, email: s.email, planId: s.plan_id,
      hasCard: !!s.mp_card_id, lastFour: s.mp_card_last_four,
      balance: Number(s.balance), pendingDebt, blockedDebt,
    };
  });
}

// Detalle de un vendedor puntual — reusa exactamente la misma lógica que ve el vendedor en
// su propia pestaña Cobro (movimientos + intentos de cobro fallidos, ya unificados).
export async function getMlSellerHistory(sellerId) {
  return mlWalletService.getHistory(sellerId);
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

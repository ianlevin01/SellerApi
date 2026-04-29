import * as repo from "./adminRepository.js";

export async function getDashboard() {
  const [stats, recentOrders, recentSellers] = await Promise.all([
    repo.getDashboardStats(),
    repo.getRecentOrders(20),
    repo.getRecentSellers(10),
  ]);
  return { stats, recentOrders, recentSellers };
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
  return seller;
}

export async function getOrders(filters) {
  return repo.getAllOrders(filters);
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

export async function getPriceConfig() {
  return repo.getPriceConfig();
}

export async function updatePriceConfig(cotizacion) {
  if (!cotizacion || Number(cotizacion) <= 0) throw { status: 400, message: "Cotización inválida" };
  await repo.updatePriceConfig(Number(cotizacion));
  return { message: "Cotización actualizada" };
}

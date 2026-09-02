import * as repo from "./adminRepository.js";
import { getAnalyticsAdmin } from "../store/analyticsRepository.js";
import { notifySellerCvuVerified, notifySellerPayoutTransferred, sendOrderPackaged, sendOrderPackagedToSeller, sendOrderShipped, sendOrderShippedToSeller } from "../email/buyerEmails.js";
import * as mlWalletService from "../ml/mlWalletService.js";
import { getPlanMlGraceHours } from "../utils/sellerPlan.js";
import { getCotizacion } from "../payouts/payoutsRepository.js";
import { getSellerPlatformPct, calcShownCost } from "../utils/pricing.js";
import { getValidToken } from "../ml/mlTokenService.js";
import * as mlSvc from "../ml/mlService.js";
import { signKeys } from "../utils/s3Client.js";

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

// El webhook de la orden puede llegar antes de que Mercado Libre termine de asignarle
// logistic_type/SLA al envío — como esa orden nunca se vuelve a tocar (ver mlWebhookController,
// el ON CONFLICT DO NOTHING solo procesa la primera notificación), queda en null para siempre
// si no se completa acá. Mismo patrón que ya usa mlLabelService para ml_shipment_id: se
// completa recién cuando hace falta (acá, al listar) y se guarda para no volver a pedirlo.
async function backfillMissingShipmentInfo(rows) {
  const pending = rows.filter(r => (!r.ml_logistic_type || !r.ml_dispatch_expected_date) && r.ml_shipment_id && !r.ml_dispatched_at);
  if (pending.length === 0) return;

  const tokenBySeller = new Map();
  for (const row of pending) {
    try {
      if (!tokenBySeller.has(row.seller_id)) {
        tokenBySeller.set(row.seller_id, await getValidToken(row.seller_id));
      }
      const token = tokenBySeller.get(row.seller_id);
      if (!token) continue;

      if (!row.ml_logistic_type) {
        const shipment = await mlSvc.getShipment(token, row.ml_shipment_id).catch(() => null);
        if (shipment?.logistic_type) {
          row.ml_logistic_type = shipment.logistic_type;
          await repo.setOrderLogisticType(row.id, shipment.logistic_type);
        }
      }
      if (!row.ml_dispatch_expected_date) {
        const sla = await mlSvc.getShipmentSla(token, row.ml_shipment_id).catch(() => null);
        if (sla?.expected_date) {
          row.ml_dispatch_expected_date = sla.expected_date;
          row.ml_dispatch_sla_status = sla.status || null;
          await repo.setOrderDispatchSla(row.id, { expectedDate: sla.expected_date, slaStatus: sla.status || null });
        }
      }
    } catch (err) {
      console.error(`[admin] no se pudo completar datos de envío del pedido ${row.id}:`, err.message);
    }
  }
}

// "Día calendario" (America/Argentina/Buenos_Aires) de una fecha — para agrupar pedidos por
// el día en que Mercado Libre exige que salgan del depósito, sin importar la hora exacta.
function toArgDateString(date) {
  if (!date) return null;
  return new Date(date).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
}

// A diferencia de logistic_type/SLA (que una vez asignados casi no cambian), el estado de
// despacho SÍ hay que re-chequearlo mientras el pedido siga sin despachar — no alcanza con
// completarlo una sola vez. El webhook de "shipments" ya lo mantiene al día en tiempo real
// (ver mlWebhookController.handleShipmentUpdate); esto es la red de seguridad para
// notificaciones perdidas, y solo pega contra pedidos todavía-no-despachados — los que ya
// están despachados no se vuelven a chequear nunca más.
async function refreshDispatchStatus(rows) {
  const pending = rows.filter(r => !r.ml_dispatched_at && r.ml_shipment_id).slice(0, 200);
  if (pending.length === 0) return;

  const tokenBySeller = new Map();
  for (const row of pending) {
    try {
      if (!tokenBySeller.has(row.seller_id)) {
        tokenBySeller.set(row.seller_id, await getValidToken(row.seller_id));
      }
      const token = tokenBySeller.get(row.seller_id);
      if (!token) continue;

      const shipment = await mlSvc.getShipment(token, row.ml_shipment_id).catch(() => null);
      if (!shipment) continue;

      const dispatched = mlSvc.isShipmentDispatched(shipment);
      row.ml_shipment_status = shipment.status || null;
      row.ml_shipment_substatus = shipment.substatus || null;
      row.ml_date_shipped = shipment.status_history?.date_shipped || null;
      if (dispatched) row.ml_dispatched_at = new Date().toISOString();

      await repo.setOrderShipmentStatus(row.id, {
        status: row.ml_shipment_status, substatus: row.ml_shipment_substatus,
        dateShipped: row.ml_date_shipped, dispatched,
      });
    } catch (err) {
      console.error(`[admin] no se pudo refrescar el estado de despacho del pedido ${row.id}:`, err.message);
    }
  }
}

// Marca cada venta con `shippable` — el bloqueo es por CUENTA, no por pedido puntual: si el
// vendedor tiene ALGUNA venta pendiente que ya superó su ventana de gracia sin cobrarse, se
// bloquean TODAS sus ventas pendientes (incluso las recientes, todavía dentro de su propia
// ventana) — mismo criterio que mlLabelService.getLabelsPdfForOrders, para que la pestaña de
// acá coincida exactamente con lo que después se puede/no se puede imprimir.
export async function getMlSales(filters) {
  const rows = await repo.getMlSales(filters);
  await backfillMissingShipmentInfo(rows);
  await refreshDispatchStatus(rows);

  // La primera imagen interna (product_images, no la de la publicación real en ML) — una
  // misma key puede repetirse muchas veces entre pedidos (mismo producto vendido varias
  // veces), así que se firma cada key única una sola vez en vez de una vez por ítem.
  const uniqueImageKeys = [...new Set(rows.flatMap(r => (r.items || []).map(i => i.imageKey).filter(Boolean)))];
  const signedImageUrls = await signKeys(uniqueImageKeys);
  const imageUrlByKey   = new Map(uniqueImageKeys.map((k, idx) => [k, signedImageUrls[idx]]));
  for (const row of rows) {
    for (const item of row.items || []) {
      item.imageUrl = item.imageKey ? (imageUrlByKey.get(item.imageKey) || null) : null;
      delete item.imageKey;
    }
  }

  const matureBySeller = new Set();
  const now = Date.now();
  for (const row of rows) {
    if (row.ml_charge_status !== "pending") continue;
    const graceHours = getPlanMlGraceHours(row.plan_id);
    const ageHours = (now - new Date(row.created_at).getTime()) / 3600000;
    if (ageHours > graceHours) matureBySeller.add(row.seller_id);
  }

  const today    = toArgDateString(new Date());
  const tomorrow = toArgDateString(new Date(Date.now() + 86400000));

  const withComputedFields = rows.map(row => {
    const dispatchDay = toArgDateString(row.ml_dispatch_expected_date);
    const isDispatched = !!row.ml_dispatched_at;
    return {
      ...row,
      shippable: row.ml_charge_status === "charged" || !matureBySeller.has(row.seller_id),
      // Al menos un ítem sin confirmar (nunca se publicó desde Ventaz, ni asignado a mano
      // todavía) — "family_name" es solo una sugerencia por título, no una asignación real.
      // Estos pedidos no generan deuda y se muestran aparte, no mezclados con los que sí.
      needsProductReview: (row.items || []).some(i => !i.productId || i.matchMethod === "family_name"),
      dispatchDay,
      isDispatched,
      // "Pendiente de hoy" = hay que despacharlo hoy o ya se pasó la fecha límite (atrasado) y
      // todavía no se marcó como despachado — un atrasado es más urgente, no menos, así que
      // entra igual en la pestaña del día. Un pedido despachado (isDispatched=true) nunca entra
      // acá ni en "mañana" — solo se vuelve a ver en la pestaña "Todos".
      needsDispatchToday: !isDispatched && !!dispatchDay && dispatchDay <= today,
      // "Pendiente de mañana" = la fecha límite es EXACTAMENTE mañana — lo de hoy (incluido lo
      // atrasado) ya se cubre en needsDispatchToday, así que acá no se repite.
      needsDispatchTomorrow: !isDispatched && dispatchDay === tomorrow,
      dispatchOverdue: !isDispatched && !!dispatchDay && dispatchDay < today,
    };
  });

  return groupByShipment(withComputedFields);
}

// Mercado Libre arma UN solo envío/etiqueta física a partir de VARIOS pedidos distintos del
// mismo vendedor (ej. el comprador agrega dos productos distintos al carrito y paga una sola
// vez) — cada producto queda como su propio ml_order_id, pero todos comparten el mismo
// ml_shipment_id. Sin agrupar acá, el panel los mostraba como ventas separadas sin ninguna
// forma de saber que en realidad es un solo paquete — riesgo real de despachar solo una parte.
// id/orderIds para imprimir: alcanza con el id del primer pedido del grupo — getLabelsPdfForOrders
// ya resuelve cualquiera de ellos a SU ml_shipment_id real y trae la etiqueta completa del
// paquete entero, no solo la parte de ese pedido puntual.
function groupByShipment(sales) {
  const byShipment = new Map();
  const result = [];
  for (const sale of sales) {
    const key = sale.ml_shipment_id;
    const existing = key ? byShipment.get(key) : null;
    if (!existing) {
      const grouped = { ...sale, numeros: [sale.numero], groupedIds: [sale.id] };
      if (key) byShipment.set(key, grouped);
      result.push(grouped);
      continue;
    }
    existing.numeros.push(sale.numero);
    existing.groupedIds.push(sale.id);
    existing.items = [...(existing.items || []), ...(sale.items || [])];
    existing.total = Number(existing.total) + Number(sale.total);
    existing.ml_cost_amount = Number(existing.ml_cost_amount || 0) + Number(sale.ml_cost_amount || 0);
    // Si cualquier pedido del grupo falló o está sin cobrar, el grupo entero se muestra así —
    // el admin tiene que poder ver que algo ahí necesita atención, no solo la parte que sí está bien.
    if (sale.ml_charge_status === "failed" || existing.ml_charge_status === "failed") existing.ml_charge_status = "failed";
    else if (sale.ml_charge_status === "pending" || existing.ml_charge_status === "pending") existing.ml_charge_status = "pending";
    existing.shippable = existing.shippable && sale.shippable;
    existing.needsProductReview = existing.needsProductReview || sale.needsProductReview;
  }
  return result;
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

// Confirmación/asignación manual del producto real de un ítem de ML que no está publicado
// desde Ventaz — sea porque no había ninguna sugerencia, o porque el sistema sugirió un
// producto por título (family_name, ver mlWebhookController.resolveUnmatchedItem) y un admin
// lo confirma acá. En ambos casos, recién acá se calcula y suma la deuda de ese ítem — hasta
// este momento quedó en $0 a propósito, nunca se cobra sola una publicación externa a Ventaz.
export async function assignMlOrderItemProduct(itemId, productId) {
  if (!productId) throw { status: 400, message: "Falta el producto a asignar" };

  const item = await repo.getUnassignedMlOrderItem(itemId);
  if (!item) throw { status: 404, message: "Ítem no encontrado o ya tiene un producto asignado" };

  const product = await repo.getProductForAssign(productId);
  if (!product) throw { status: 404, message: "Producto no encontrado" };

  const cotizacion = await getCotizacion();
  const platformPct = getSellerPlatformPct(0);
  const unitCost = calcShownCost(product.costo_usd, cotizacion, platformPct, item.plan_id);

  const result = await repo.assignMlOrderItemProduct(itemId, {
    productId, productName: product.name, unitCost, sellerId: item.seller_id,
  });
  if (!result) throw { status: 404, message: "No se pudo asignar — el ítem puede haber cambiado" };
  return { message: "Producto asignado y deuda generada" };
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

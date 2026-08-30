// src/ml/mlStatsService.js
import * as repo from "./mlStatsRepository.js";
import * as svc from "./mlService.js";
import { getValidToken } from "./mlTokenService.js";
import { signKey } from "../utils/s3Client.js";

const ART = "America/Argentina/Buenos_Aires";

// Todas las fechas acá son strings "YYYY-MM-DD" en calendario de Argentina — mismo formato que
// manda el frontend y que el repositorio compara con (created_at AT TIME ZONE ART)::date, así
// que nunca hay que convertir a Date con horas/zona horaria del proceso (evita corrimientos de
// un día si el servidor corre en UTC). shiftDateStr ancla a mediodía UTC como truco para poder
// sumar/restar días con el motor de Date de JS sin pisarse con horario de verano.
function argToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: ART });
}

function shiftDateStr(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetweenInclusive(from, to) {
  const a = new Date(`${from}T12:00:00Z`);
  const b = new Date(`${to}T12:00:00Z`);
  return Math.round((b - a) / (24 * 60 * 60 * 1000)) + 1;
}

function daysInMonth(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Backfill liviano de provincia/ciudad/entrega para pedidos que ya tenían shipment_id antes de
// que empezáramos a guardar estos campos — mismo patrón "completar al leer" que ya usa
// adminService.backfillMissingShipmentInfo. Silencioso ante errores puntuales (token vencido,
// shipment ya no disponible, etc.) para no romper la carga de toda la pantalla por un pedido.
async function backfillGeoData(sellerId, from, to) {
  const pending = await repo.getOrdersMissingGeoData(sellerId, from, to);
  if (pending.length === 0) return;
  const token = await getValidToken(sellerId).catch(() => null);
  if (!token) return;
  for (const row of pending) {
    try {
      const shipment = await svc.getShipment(token, row.ml_shipment_id).catch(() => null);
      if (!shipment) continue;
      await repo.setOrderGeoAndDelivery(row.id, {
        province: shipment.receiver_address?.state?.name || null,
        city: shipment.receiver_address?.city?.name || null,
        deliveredAt: shipment.status_history?.date_delivered || null,
      });
    } catch (err) {
      console.error(`[ml-stats] no se pudo completar geo/entrega del pedido ${row.id}:`, err.message);
    }
  }
}

function periodBounds(from, to) {
  const days = daysBetweenInclusive(from, to);
  const prevTo   = shiftDateStr(from, -1);
  const prevFrom = shiftDateStr(prevTo, -(days - 1));
  return { prevFrom, prevTo };
}

function pctChange(current, previous) {
  if (!previous) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

// Alertas en lenguaje natural — solo las que se pueden calcular con lo que ya se trajo en esta
// misma carga (nada de historial nuevo). Ordenadas por lo que más le importa a un vendedor:
// primero plata, después riesgo de quedarse sin stock de lo que más vende.
function buildAlerts({ kpis, prevKpis, products }) {
  const alerts = [];
  const revenueChange = pctChange(kpis.revenue, prevKpis.revenue);
  if (Math.abs(revenueChange) >= 10) {
    alerts.push({
      severity: revenueChange >= 0 ? "good" : "warning",
      text: `La facturación ${revenueChange >= 0 ? "subió" : "bajó"} ${Math.abs(revenueChange)}% respecto al período anterior.`,
    });
  }

  const cancelRate = kpis.totalOrdersAnyStatus > 0 ? (kpis.cancelledCount / kpis.totalOrdersAnyStatus) * 100 : 0;
  const prevCancelRate = prevKpis.totalOrdersAnyStatus > 0 ? (prevKpis.cancelledCount / prevKpis.totalOrdersAnyStatus) * 100 : 0;
  if (cancelRate >= 15 && cancelRate > prevCancelRate) {
    alerts.push({ severity: "danger", text: `${Math.round(cancelRate)}% de tus pedidos se cancelaron o rechazaron en este período — más que antes.` });
  }

  if (products.length > 0) {
    const top = products[0];
    alerts.push({ severity: "good", text: `"${top.name}" es tu producto que más facturó (${top.units} unidades vendidas).` });
    if (top.currentStock != null && top.currentStock <= 5) {
      alerts.push({ severity: "danger", text: `"${top.name}" es tu producto más vendido y le queda poco stock (${top.currentStock} unidades) — priorizalo para reponer.` });
    }
  }

  const lowStockTop = products.slice(0, 8).filter(p => p.currentStock != null && p.currentStock > 0 && p.currentStock <= 5 && p.productId !== products[0]?.productId);
  lowStockTop.forEach(p => alerts.push({ severity: "warning", text: `"${p.name}" vendió bien este período y le quedan solo ${p.currentStock} unidades.` }));

  const priority = { danger: 0, warning: 1, good: 2 };
  return alerts.sort((a, b) => priority[a.severity] - priority[b.severity]);
}

export async function getStats(sellerId, { from, to, groupBy = "day" }) {
  const { prevFrom, prevTo } = periodBounds(from, to);

  await backfillGeoData(sellerId, from, to);

  const [kpis, prevKpis, timeSeries, heatmap, products, provinces, shipping] = await Promise.all([
    repo.getKpis(sellerId, from, to),
    repo.getKpis(sellerId, prevFrom, prevTo),
    repo.getTimeSeries(sellerId, from, to, groupBy),
    repo.getHeatmap(sellerId, from, to),
    repo.getProductBreakdown(sellerId, from, to),
    repo.getProvinceBreakdown(sellerId, from, to),
    repo.getShippingBreakdown(sellerId, from, to),
  ]);

  const productsWithImages = await Promise.all(products.map(async p => ({
    ...p,
    imageUrl: p.imageKey ? await signKey(p.imageKey).catch(() => null) : null,
    revenueShare: kpis.revenue > 0 ? Math.round((p.revenue / kpis.revenue) * 1000) / 10 : 0,
  })));

  const avgTicket = kpis.orders > 0 ? kpis.revenue / kpis.orders : 0;
  const prevAvgTicket = prevKpis.orders > 0 ? prevKpis.revenue / prevKpis.orders : 0;
  const profit = kpis.revenue - kpis.costTotal;
  const cancelRate = kpis.totalOrdersAnyStatus > 0 ? Math.round((kpis.cancelledCount / kpis.totalOrdersAnyStatus) * 1000) / 10 : 0;
  const returnRate = kpis.orders > 0 ? Math.round((kpis.refundedCount / (kpis.orders + kpis.refundedCount)) * 1000) / 10 : 0;

  // El objetivo siempre es del mes calendario actual (en hora de Argentina), sea cual sea el
  // rango que esté mirando el vendedor en el resto de la pantalla.
  const today = argToday();
  const currentMonthKey = today.slice(0, 7);
  const goal = await repo.getMonthlyGoal(sellerId, currentMonthKey);
  let goalInfo = null;
  if (goal) {
    const monthStart = `${currentMonthKey}-01`;
    const totalDays  = daysInMonth(currentMonthKey);
    const monthEnd   = shiftDateStr(monthStart, totalDays - 1);
    const dayOfMonth = Number(today.slice(8, 10));
    const monthKpis  = await repo.getKpis(sellerId, monthStart, monthEnd);
    const projected  = (monthKpis.revenue / dayOfMonth) * totalDays;
    goalInfo = {
      goal, current: monthKpis.revenue, progressPct: Math.min(100, Math.round((monthKpis.revenue / goal) * 1000) / 10),
      projected: Math.round(projected), onTrack: projected >= goal,
    };
  }

  return {
    period: { from, to },
    kpis: {
      revenue: kpis.revenue, revenueChangePct: pctChange(kpis.revenue, prevKpis.revenue),
      orders: kpis.orders, ordersChangePct: pctChange(kpis.orders, prevKpis.orders),
      units: kpis.units, unitsChangePct: pctChange(kpis.units, prevKpis.units),
      avgTicket, avgTicketChangePct: pctChange(avgTicket, prevAvgTicket),
      profit, profitNote: "Facturación menos costo de producto — no incluye comisión de Mercado Libre ni impuestos.",
      uniqueBuyers: kpis.uniqueBuyers,
      cancelRate, returnRate, refundedCount: kpis.refundedCount, cancelledCount: kpis.cancelledCount,
    },
    timeSeries, heatmap,
    products: productsWithImages,
    provinces, shipping,
    alerts: buildAlerts({ kpis, prevKpis, products: productsWithImages }),
    goal: goalInfo,
  };
}

export async function setGoal(sellerId, monthKey, revenueGoal) {
  if (!revenueGoal || Number(revenueGoal) <= 0) { const e = new Error("Meta inválida"); e.status = 400; throw e; }
  await repo.setMonthlyGoal(sellerId, monthKey, Number(revenueGoal));
}

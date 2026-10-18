// src/finance/financeService.js — junta ventas reales de ML (mlStatsRepository) con los gastos
// que el vendedor carga a mano acá, y calcula la ganancia real mes a mes. Ver nota grande en
// getMonthlySummary sobre qué significa "ganancia bruta" vs. "ganancia neta".
import * as mlStatsRepository from "../ml/mlStatsRepository.js";
import * as financeRepository from "./financeRepository.js";
import { getValidToken } from "../ml/mlTokenService.js";
import * as mlRepository from "../ml/mlRepository.js";
import * as mlService from "../ml/mlService.js";

// Últimos `monthsBack` meses, más viejo primero, en formato 'YYYY-MM' — incluye el mes actual.
function lastMonthKeys(monthsBack) {
  const keys = [];
  const now = new Date();
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

function monthDateRange(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const from = `${monthKey}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const to = `${monthKey}-${String(lastDay).padStart(2, "0")}`;
  const today = new Date().toISOString().slice(0, 10);
  return { from, to: to > today ? today : to };
}

// Confirmado en vivo (13/10): la Advertising API de ML rechaza con 400 "You cannot request
// metrics with a date greater than 90 days" cualquier rango con más de 90 días de antigüedad —
// no es un límite de documentación sin confirmar, es el rechazo real. Antes de esto, el vendedor
// con 12 meses de historial le pegaba a ML 9 veces por nada (siempre con el mismo error), cada
// una sumando latencia real a la pantalla de Rentabilidad — ahora esos meses ni se consultan,
// directo caen a la carga manual (misma UX que "esta cuenta no tiene Product Ads").
// Ojo: el límite aplica sobre date_from, no date_to (confirmado en vivo — un rango con
// date_from de más de 90 días se rechaza aunque date_to esté adentro de la ventana).
const ADS_API_WINDOW_DAYS = 90;
function isWithinAdsWindow(fromDateStr) {
  const ageMs = Date.now() - new Date(`${fromDateStr}T00:00:00Z`).getTime();
  return ageMs <= ADS_API_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

// advertiser_id real de la cuenta de ML conectada, o null si no está conectada o si la cuenta
// no tiene Product Ads habilitado. Confirmado en vivo (7/10): una cuenta sin Product Ads
// responde 404 "No permissions found for user_id" acá — no es un error de Ventaz, es la señal
// real de "esta cuenta no tiene publicidad activa", así que se cae a la carga manual sin loguear
// nada raro.
async function getAdAccountInfo(sellerId) {
  const conn = await mlRepository.getConnection(sellerId).catch(() => null);
  if (!conn) return null;
  const token = await getValidToken(sellerId).catch(() => null);
  if (!token) return null;
  try {
    const { advertisers } = await mlService.getAdvertisers(token);
    const advertiserId = advertisers?.[0]?.advertiser_id;
    if (!advertiserId) return null;
    return { token, siteId: conn.site_id || "MLA", advertiserId };
  } catch {
    return null;
  }
}

export async function getMonthlySummary(sellerId, monthsBack = 12) {
  const clampedMonths = Math.min(Math.max(Number(monthsBack) || 12, 1), 24);
  const monthKeys = lastMonthKeys(clampedMonths);

  const [salesRows, entryRows, adAccount] = await Promise.all([
    mlStatsRepository.getMonthlyFinanceBreakdown(sellerId, clampedMonths),
    financeRepository.getEntries(sellerId, monthKeys),
    getAdAccountInfo(sellerId),
  ]);
  const salesByMonth   = new Map(salesRows.map(r => [r.monthKey, r]));
  const entriesByMonth = new Map(entryRows.map(r => [r.monthKey, r]));

  // Gasto real de Product Ads por mes, solo para cuentas que lo tienen habilitado (ver
  // getAdAccountInfo) — secuencial, no Promise.all, para no ráfaguear la API de ML (ya vimos un
  // 429 rate_limited en pruebas). Los meses de más de 90 días ni se consultan (ver
  // isWithinAdsWindow) — ya sabemos que ML los va a rechazar, así que de paso esto acota el
  // loop a como mucho ~3 meses reales sin importar cuántos meses pidió el frontend. Si un mes
  // puntual falla igual (motivo distinto al de los 90 días), ese mes cae a la carga manual en
  // vez de romper toda la pantalla.
  const adCostByMonth = new Map();
  if (adAccount) {
    for (const monthKey of monthKeys) {
      const { from, to } = monthDateRange(monthKey);
      if (!isWithinAdsWindow(from)) continue;
      try {
        const cost = await mlService.getProductAdsCostTotal(adAccount.token, adAccount.siteId, adAccount.advertiserId, from, to);
        adCostByMonth.set(monthKey, cost);
      } catch (err) {
        console.error(`[finance] no se pudo traer gasto de Product Ads de ${monthKey}:`, err.message);
      }
    }
  }

  return monthKeys.map(monthKey => {
    const sales = salesByMonth.get(monthKey) || { revenue: 0, productCost: 0, shippingCost: 0, mlCommission: 0 };
    const entry = entriesByMonth.get(monthKey) || { advertising: 0, grossReceiptsTax: 0, fixedCosts: 0 };
    const autoAdvertising = adCostByMonth.get(monthKey);
    // El dato real de ML siempre gana cuando está disponible — la carga manual de ese mes queda
    // guardada igual (no se borra, ver financeRepository), por si el día de mañana Product Ads
    // deja de estar disponible para esta cuenta.
    const advertising = autoAdvertising != null ? autoAdvertising : entry.advertising;

    // Ganancia bruta: solo lo que la propia operación de Mercado Libre determina (facturación
    // menos costo de producto, comisión real de ML y envío que absorbe el vendedor) — estos 4
    // valores son datos reales de la API de ML, nunca estimados.
    const grossProfit = sales.revenue - sales.productCost - sales.mlCommission - sales.shippingCost;
    // Ganancia neta: le resta encima publicidad (automática si está disponible, manual si no),
    // Ingresos Brutos y gastos fijos — estos dos últimos Mercado Libre nunca los va a reportar.
    const netProfit = grossProfit - advertising - entry.grossReceiptsTax - entry.fixedCosts;

    return {
      monthKey,
      revenue:          sales.revenue,
      productCost:      sales.productCost,
      mlCommission:     sales.mlCommission,
      shippingCost:     sales.shippingCost,
      grossProfit,
      advertising,
      advertisingSource: autoAdvertising != null ? "ml" : "manual",
      grossReceiptsTax:  entry.grossReceiptsTax,
      fixedCosts:        entry.fixedCosts,
      netProfit,
    };
  });
}

// Meses que toca un rango arbitrario, con cuántos días de cada uno caen dentro del rango — la
// carga manual (publicidad/Ingresos Brutos/gastos fijos) es un monto único POR MES CALENDARIO
// (el vendedor no la carga por día), así que para un rango que empieza o termina a mitad de
// mes no hay forma de saber "cuánto de ese gasto corresponde a estos días puntuales" — se
// prorratea por días como la aproximación más razonable, y se lo marca como tal en la respuesta
// (ver isExact) para no mostrarlo como si fuera un dato real.
function monthsOverlapping(fromStr, toStr) {
  const from = new Date(`${fromStr}T00:00:00Z`);
  const to = new Date(`${toStr}T00:00:00Z`);
  const months = [];
  let y = from.getUTCFullYear(), m = from.getUTCMonth();
  while (Date.UTC(y, m, 1) <= to.getTime()) {
    const monthStart = new Date(Date.UTC(y, m, 1));
    const monthEnd = new Date(Date.UTC(y, m + 1, 0));
    const daysInMonth = monthEnd.getUTCDate();
    const overlapStart = monthStart > from ? monthStart : from;
    const overlapEnd = monthEnd < to ? monthEnd : to;
    const overlapDays = Math.round((overlapEnd - overlapStart) / 86400000) + 1;
    months.push({ monthKey: `${y}-${String(m + 1).padStart(2, "0")}`, overlapDays, daysInMonth });
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return months;
}

export async function getRangeSummary(sellerId, fromInput, toInput) {
  const today = new Date().toISOString().slice(0, 10);
  const from = fromInput;
  const to = toInput > today ? today : toInput;
  if (!from || !to || from > to) { const e = new Error("Rango de fechas inválido"); e.status = 400; throw e; }

  const months = monthsOverlapping(from, to);
  const monthKeys = months.map(m => m.monthKey);

  const [sales, entryRows, adAccount] = await Promise.all([
    mlStatsRepository.getFinanceBreakdownForRange(sellerId, from, to),
    financeRepository.getEntries(sellerId, monthKeys),
    getAdAccountInfo(sellerId),
  ]);
  const entriesByMonth = new Map(entryRows.map(r => [r.monthKey, r]));

  // Publicidad: si la cuenta tiene Product Ads Y el rango entero entra en la ventana de 90 días,
  // se pide el gasto EXACTO de ese rango puntual directo a ML (más preciso todavía que por mes,
  // no hace falta prorratear nada acá). Si no, se prorratea la carga manual de cada mes que toca
  // el rango, igual que Ingresos Brutos/gastos fijos.
  let advertising = 0;
  let advertisingSource = "manual";
  let adsExact = true;
  if (adAccount && isWithinAdsWindow(from)) {
    try {
      advertising = await mlService.getProductAdsCostTotal(adAccount.token, adAccount.siteId, adAccount.advertiserId, from, to);
      advertisingSource = "ml";
    } catch (err) {
      console.error(`[finance] no se pudo traer gasto de Product Ads del rango ${from}/${to}:`, err.message);
      adsExact = false;
    }
  } else {
    adsExact = false;
  }

  let grossReceiptsTax = 0, fixedCosts = 0;
  for (const { monthKey, overlapDays, daysInMonth } of months) {
    const entry = entriesByMonth.get(monthKey) || { advertising: 0, grossReceiptsTax: 0, fixedCosts: 0 };
    const fraction = overlapDays / daysInMonth;
    if (!adsExact) advertising += entry.advertising * fraction;
    grossReceiptsTax += entry.grossReceiptsTax * fraction;
    fixedCosts += entry.fixedCosts * fraction;
  }
  // El rango cubre el mes completo para todos los meses involucrados → el prorrateo de
  // Ingresos Brutos/gastos fijos coincide exactamente con lo cargado, no es una aproximación.
  const isFullMonths = months.every(m => m.overlapDays === m.daysInMonth);

  const grossProfit = sales.revenue - sales.productCost - sales.mlCommission - sales.shippingCost;
  const netProfit = grossProfit - advertising - grossReceiptsTax - fixedCosts;

  return {
    from, to,
    revenue: sales.revenue, productCost: sales.productCost, mlCommission: sales.mlCommission, shippingCost: sales.shippingCost,
    grossProfit,
    advertising, advertisingSource,
    grossReceiptsTax, fixedCosts,
    netProfit,
    // true si Ingresos Brutos/gastos fijos son el monto exacto cargado (el rango cubre meses
    // completos); false si se prorratearon por abarcar solo una parte de algún mes.
    isManualExact: isFullMonths,
  };
}

function toNonNegativeNumber(value, fieldLabel) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    const e = new Error(`${fieldLabel} debe ser un número mayor o igual a 0`);
    e.status = 400;
    throw e;
  }
  return n;
}

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function setMonthlyEntry(sellerId, monthKey, { advertising, grossReceiptsTax, fixedCosts }) {
  if (!MONTH_KEY_RE.test(monthKey)) { const e = new Error("month key inválido"); e.status = 400; throw e; }
  await financeRepository.upsertEntry(sellerId, monthKey, {
    advertising:      toNonNegativeNumber(advertising, "Publicidad"),
    grossReceiptsTax: toNonNegativeNumber(grossReceiptsTax, "Ingresos Brutos"),
    fixedCosts:       toNonNegativeNumber(fixedCosts, "Gastos fijos"),
  });
}

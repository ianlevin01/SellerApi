import pool from "../database/db.js";

const PLAN_STORE_LIMITS = { inicial: 1, pro: 4, max: Infinity };
const PLAN_PAYOUT_DAYS  = { inicial: 14, pro: 7, max: 0 };
const PLAN_ML_LISTING_LIMITS = { inicial: 10, pro: 50, max: Infinity };
// Horas de gracia antes de que la deuda de ventas de ML se vuelva obligatoria (bloquea envío
// de pedidos y pausa publicaciones si no se cobra). Inicial no tiene gracia: se cobra en el
// corte del mismo día que se vendió, sí o sí.
const PLAN_ML_GRACE_HOURS = { inicial: 0, pro: 24, max: 72 };

const _cache = new Map();

export async function getSellerPlan(sellerId) {
  const cached = _cache.get(sellerId);
  if (cached && cached.ts > Date.now() - 60_000) return cached.data;

  const { rows } = await pool.query(
    `SELECT plan_id, plan_status, plan_period_end FROM sellers WHERE id = $1`,
    [sellerId]
  );
  const data = {
    plan_id:     rows[0]?.plan_id     || "inicial",
    plan_status: rows[0]?.plan_status || "trial",
    period_end:  rows[0]?.plan_period_end || null,
  };
  _cache.set(sellerId, { data, ts: Date.now() });
  return data;
}

export function getPlanStoreLimit(planId) {
  return PLAN_STORE_LIMITS[planId] ?? 2;
}

export function getPlanPayoutDays(planId) {
  return PLAN_PAYOUT_DAYS[planId] ?? 14;
}

export function getPlanMlListingLimit(planId) {
  return PLAN_ML_LISTING_LIMITS[planId] ?? 10;
}

export function getPlanMlGraceHours(planId) {
  return PLAN_ML_GRACE_HOURS[planId] ?? 0;
}

export function invalidatePlanCache(sellerId) {
  _cache.delete(sellerId);
}

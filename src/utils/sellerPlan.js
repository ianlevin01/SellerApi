import pool from "../database/db.js";

const PLAN_STORE_LIMITS = { inicial: 1, pro: 4, max: Infinity };
const PLAN_PAYOUT_DAYS  = { inicial: 14, pro: 7, max: 0 };

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

export function invalidatePlanCache(sellerId) {
  _cache.delete(sellerId);
}

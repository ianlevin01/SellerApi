import pool from "../database/db.js";

export async function getPlans() {
  const { rows } = await pool.query(
    `SELECT id, name, price_ars, description, sort_order, mp_plan_id
     FROM subscription_plans
     WHERE active = TRUE
     ORDER BY sort_order ASC`
  );
  return rows;
}

export async function getPlanById(planId) {
  const { rows } = await pool.query(
    `SELECT * FROM subscription_plans WHERE id = $1 AND active = TRUE`,
    [planId]
  );
  return rows[0] || null;
}

export async function getSellerSubscription(sellerId) {
  const { rows } = await pool.query(
    `SELECT s.plan_id, s.plan_status, s.trial_ends_at,
            s.mp_subscription_id, s.plan_period_end, s.plan_updated_at,
            s.pending_plan_id,
            sp.id AS plan_name_id, sp.name AS plan_name, sp.price_ars, sp.description
     FROM sellers s
     LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
     WHERE s.id = $1`,
    [sellerId]
  );
  return rows[0] || null;
}

export async function updateSellerSubscription(sellerId, fields) {
  const {
    plan_id,
    plan_status,
    mp_subscription_id,
    plan_period_end,
    pending_plan_id,
    clear_pending,
  } = fields;

  const { rows } = await pool.query(
    `UPDATE sellers
     SET plan_id            = COALESCE($1, plan_id),
         plan_status        = COALESCE($2, plan_status),
         mp_subscription_id = COALESCE($3, mp_subscription_id),
         plan_period_end    = COALESCE($4, plan_period_end),
         pending_plan_id    = CASE WHEN $6 THEN NULL ELSE COALESCE($5, pending_plan_id) END,
         plan_updated_at    = now()
     WHERE id = $7
     RETURNING plan_id, plan_status, mp_subscription_id, plan_period_end, pending_plan_id`,
    [
      plan_id        || null,
      plan_status    || null,
      mp_subscription_id || null,
      plan_period_end || null,
      pending_plan_id || null,
      clear_pending ? true : false,
      sellerId,
    ]
  );
  return rows[0] || null;
}

export async function applyPendingPlan(sellerId, newPlanId) {
  await pool.query(
    `UPDATE sellers
     SET plan_id         = $1,
         pending_plan_id = NULL,
         plan_status     = 'expired',
         plan_updated_at = now()
     WHERE id = $2`,
    [newPlanId, sellerId]
  );
}

export async function findSellerByMpSubscriptionId(mpSubscriptionId) {
  const { rows } = await pool.query(
    `SELECT id, email, name, plan_id, plan_status FROM sellers WHERE mp_subscription_id = $1`,
    [mpSubscriptionId]
  );
  return rows[0] || null;
}

export async function findSellerByEmail(email) {
  const { rows } = await pool.query(
    `SELECT id, email, name, plan_id, plan_status FROM sellers WHERE email = $1`,
    [email]
  );
  return rows[0] || null;
}

export async function findSellerByPendingPlan(internalPlanId) {
  const { rows } = await pool.query(
    `SELECT id, email, name, plan_id, plan_status, pending_plan_id
     FROM sellers
     WHERE pending_plan_id = $1
       AND plan_updated_at > now() - INTERVAL '2 hours'
     ORDER BY plan_updated_at DESC
     LIMIT 1`,
    [internalPlanId]
  );
  return rows[0] || null;
}

export async function findSellerById(id) {
  const { rows } = await pool.query(
    `SELECT id, email, name, plan_id, plan_status FROM sellers WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function savePlanMpId(planId, mpPlanId) {
  await pool.query(
    `UPDATE subscription_plans SET mp_plan_id = $1 WHERE id = $2`,
    [mpPlanId, planId]
  );
}

// ── Pagos individuales ───────────────────────────────────────

export async function savePayment(sellerId, { mpPaymentId, planId, amount, status, statusDetail, paymentDate }) {
  await pool.query(
    `INSERT INTO subscription_payments (seller_id, mp_payment_id, plan_id, amount, status, status_detail, payment_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (mp_payment_id) DO UPDATE SET status = EXCLUDED.status, status_detail = EXCLUDED.status_detail`,
    [sellerId, mpPaymentId, planId || null, amount || null, status, statusDetail || null, paymentDate || new Date()]
  );
}

export async function getPaymentHistory(sellerId) {
  const { rows } = await pool.query(
    `SELECT sp.id, sp.mp_payment_id, sp.plan_id, sp.amount, sp.status, sp.status_detail, sp.payment_date,
            pl.name AS plan_name
     FROM subscription_payments sp
     LEFT JOIN subscription_plans pl ON pl.id = sp.plan_id
     WHERE sp.seller_id = $1
     ORDER BY sp.payment_date DESC
     LIMIT 24`,
    [sellerId]
  );
  return rows;
}

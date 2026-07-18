import pool from "../database/db.js";

export async function getSellerEmail(sellerId) {
  const { rows } = await pool.query(`SELECT email FROM sellers WHERE id = $1`, [sellerId]);
  return rows[0]?.email || null;
}

export async function saveCard(sellerId, { mpCustomerId, mpCardId, lastFour, paymentMethodId }) {
  await pool.query(
    `UPDATE ml_connections
     SET mp_customer_id = $1, mp_card_id = $2, mp_card_last_four = $3, mp_card_payment_method_id = $4
     WHERE seller_id = $5`,
    [mpCustomerId, mpCardId, lastFour, paymentMethodId, sellerId]
  );
}

export async function getCardInfo(sellerId) {
  const { rows } = await pool.query(
    `SELECT mp_customer_id, mp_card_id, mp_card_last_four, mp_card_payment_method_id
     FROM ml_connections WHERE seller_id = $1`,
    [sellerId]
  );
  return rows[0] || null;
}

export async function getBalance(sellerId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS balance
     FROM ml_wallet_transactions WHERE seller_id = $1 AND method = 'balance'`,
    [sellerId]
  );
  return Number(rows[0].balance);
}

export async function insertTransaction(sellerId, { type, method, amount, mlOrderId, mpPaymentId, description }) {
  const { rows } = await pool.query(
    `INSERT INTO ml_wallet_transactions (seller_id, type, method, amount, ml_order_id, mp_payment_id, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [sellerId, type, method, amount, mlOrderId || null, mpPaymentId || null, description || null]
  );
  return rows[0];
}

export async function getTransactionHistory(sellerId, limit = 50) {
  const { rows } = await pool.query(
    `SELECT * FROM ml_wallet_transactions WHERE seller_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [sellerId, limit]
  );
  return rows;
}

// ── Pedidos pendientes de cobro (para el corte diario) ─────────

// Deuda acumulada de un seller puntual — ventas de ML ya registradas pero todavía no
// incluidas en el corte diario. Se resetea a 0 cuando el corte cobra exitosamente
// (mlDailyChargeJob marca esas órdenes como 'charged').
export async function getPendingDebt(sellerId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(ml_cost_amount), 0) AS pending
     FROM web_orders
     WHERE seller_id = $1 AND channel = 'mercadolibre' AND ml_charge_status = 'pending'`,
    [sellerId]
  );
  return Number(rows[0].pending);
}

// created_at es necesario para que el corte diario pueda separar la deuda "madura" (más vieja
// que la gracia del plan del seller, se cobra sí o sí) de la "no madura" (todavía dentro de la
// ventana de gracia, se intenta cobrar pero no bloquea nada si falla).
// Deuda que ya superó la ventana de gracia del plan del seller — es la que bloquea el envío
// de pedidos y, si el corte diario no logra cobrarla, pausa las publicaciones.
export async function getBlockedDebt(sellerId, graceHours) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(ml_cost_amount), 0) AS blocked
     FROM web_orders
     WHERE seller_id = $1 AND channel = 'mercadolibre' AND ml_charge_status = 'pending'
       AND created_at <= now() - ($2 || ' hours')::interval`,
    [sellerId, graceHours]
  );
  return Number(rows[0].blocked);
}

export async function getPendingChargesBySeller() {
  const { rows } = await pool.query(
    `SELECT seller_id, id AS order_id, ml_order_id, ml_cost_amount, created_at
     FROM web_orders
     WHERE channel = 'mercadolibre' AND ml_charge_status = 'pending'
     ORDER BY seller_id, created_at`
  );
  const bySeller = new Map();
  for (const row of rows) {
    if (!bySeller.has(row.seller_id)) bySeller.set(row.seller_id, []);
    bySeller.get(row.seller_id).push(row);
  }
  return bySeller;
}

// Todas las ventas de ML de un seller todavía no cobradas — usado por el botón de "pagar
// deuda ahora" (paga todo de una, madura y no madura).
export async function getPendingOrdersForSeller(sellerId) {
  const { rows } = await pool.query(
    `SELECT id AS order_id, ml_order_id, ml_cost_amount, created_at
     FROM web_orders
     WHERE seller_id = $1 AND channel = 'mercadolibre' AND ml_charge_status = 'pending'
     ORDER BY created_at`,
    [sellerId]
  );
  return rows;
}

export async function markOrdersChargeStatus(orderIds, status) {
  if (orderIds.length === 0) return;
  await pool.query(
    `UPDATE web_orders SET ml_charge_status = $1 WHERE id = ANY($2::uuid[])`,
    [status, orderIds]
  );
}

// Registra cada intento del corte diario (o del botón de pago manual), haya salido bien o
// mal — a diferencia de ml_wallet_transactions, que solo registra los movimientos de plata
// que sí se concretaron.
export async function insertChargeAttempt(sellerId, { kind, amount, success, method, reason, mpPaymentId }) {
  const { rows } = await pool.query(
    `INSERT INTO ml_charge_attempts (seller_id, kind, amount, success, method, reason, mp_payment_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [sellerId, kind, amount, success, method || null, reason || null, mpPaymentId || null]
  );
  return rows[0];
}

// Solo los intentos que fallaron — los que salieron bien ya quedan reflejados en
// ml_wallet_transactions (el movimiento de plata real), no hace falta duplicarlos acá.
export async function getFailedChargeAttempts(sellerId, limit = 30) {
  const { rows } = await pool.query(
    `SELECT * FROM ml_charge_attempts WHERE seller_id = $1 AND success = false ORDER BY attempted_at DESC LIMIT $2`,
    [sellerId, limit]
  );
  return rows;
}

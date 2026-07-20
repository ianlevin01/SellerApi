import * as repo from "./mlWalletRepository.js";
import * as cardSvc from "./mlCardService.js";
import * as listingSvc from "./mlListingService.js";
import { getSellerPlan, getPlanMlGraceHours } from "../utils/sellerPlan.js";

export async function getBalance(sellerId) {
  return repo.getBalance(sellerId);
}

export async function getPendingDebt(sellerId) {
  return repo.getPendingDebt(sellerId);
}

// Deuda que ya superó la ventana de gracia del plan — la que bloquea el envío de pedidos y
// puede pausar publicaciones si el corte diario no logra cobrarla.
export async function getBlockedDebt(sellerId) {
  const { plan_id } = await getSellerPlan(sellerId);
  const graceHours = getPlanMlGraceHours(plan_id);
  return repo.getBlockedDebt(sellerId, graceHours);
}

// Compartido por "pagar deuda ahora" y "pagar deuda obligatoria" — solo cambia qué conjunto
// de órdenes se le pasa.
async function chargeOrdersNow(sellerId, orders, description) {
  if (orders.length === 0) {
    const e = new Error("No tenés deuda pendiente para pagar");
    e.status = 400;
    throw e;
  }

  const total = orders.reduce((sum, o) => sum + Number(o.ml_cost_amount || 0), 0);
  const orderIds = orders.map(o => o.order_id);

  const result = await debitOrCharge(sellerId, total, {
    mlOrderId: orders.map(o => o.ml_order_id).join(","),
    description,
  });

  await repo.insertChargeAttempt(sellerId, {
    kind: "manual", amount: total, success: result.ok,
    method: result.method, reason: result.reason, mpPaymentId: result.mpPaymentId,
  });

  if (!result.ok) {
    const e = new Error("No se pudo cobrar la tarjeta. Probá con otra o revisá el saldo.");
    e.status = 402;
    throw e;
  }

  await repo.markOrdersChargeStatus(orderIds, "charged");
  await listingSvc.reactivateListingsAfterChargeSuccess(sellerId).catch(() => {});
  return { ok: true, amount: total };
}

// Botón "Pagar deuda ahora" — cobra TODA la deuda pendiente (madura y no madura) de una vez,
// desde la tarjeta guardada, y reactiva lo que estuviera pausado por cobro fallido.
export async function payPendingDebtNow(sellerId) {
  const orders = await repo.getPendingOrdersForSeller(sellerId);
  return chargeOrdersNow(sellerId, orders, `Pago manual de deuda de Mercado Libre (${orders.length} venta(s))`);
}

// Botón "Pagar deuda obligatoria" — cobra SOLO la parte ya vencida (fuera del período de
// gracia del plan), dejando la que todavía está en gracia sin tocar.
export async function payBlockedDebtNow(sellerId) {
  const { plan_id } = await getSellerPlan(sellerId);
  const graceHours = getPlanMlGraceHours(plan_id);
  const orders = await repo.getBlockedOrdersForSeller(sellerId, graceHours);
  return chargeOrdersNow(sellerId, orders, `Pago de deuda obligatoria de Mercado Libre (${orders.length} venta(s))`);
}

export async function getCardStatus(sellerId) {
  const card = await repo.getCardInfo(sellerId);
  return {
    hasCard:  !!card?.mp_card_id,
    lastFour: card?.mp_card_last_four || null,
  };
}

// Se llama con el card_token que generó el SDK de MP en el frontend al guardar la tarjeta.
export async function saveCard(sellerId, cardToken) {
  const email = await repo.getSellerEmail(sellerId);
  const saved = await cardSvc.saveCard(email, cardToken);
  await repo.saveCard(sellerId, saved);
  return { lastFour: saved.lastFour };
}

// Carga de saldo manual — el vendedor elige cuánto cargar, se cobra a la tarjeta guardada.
export async function topup(sellerId, amount) {
  const card = await repo.getCardInfo(sellerId);
  if (!card?.mp_card_id) {
    const err = new Error("Necesitás guardar una tarjeta antes de cargar saldo");
    err.status = 400;
    throw err;
  }

  const result = await cardSvc.chargeSavedCard({
    mpCustomerId:    card.mp_customer_id,
    mpCardId:        card.mp_card_id,
    paymentMethodId: card.mp_card_payment_method_id,
    amount,
    description:     "Carga de saldo Ventaz — Mercado Libre",
    externalReference: `topup-${sellerId}-${Date.now()}`,
  });

  if (!result.approved) {
    const err = new Error("No se pudo cobrar la tarjeta. Probá con otra o revisá el saldo.");
    err.status = 402;
    throw err;
  }

  // method='balance' porque esta carga SUMA al saldo disponible (aunque el cobro en sí haya
  // sido con tarjeta) — getBalance() suma solo transacciones method='balance'. Si esto quedara
  // en method='card' (como estaba antes), el saldo cargado nunca aparecería disponible.
  return repo.insertTransaction(sellerId, {
    type: "topup", method: "balance", amount: Number(amount),
    mpPaymentId: result.mpPaymentId, description: "Carga de saldo",
  });
}

// Débito por el costo de una venta de ML: primero contra el saldo, si no alcanza cobra la tarjeta.
// amount siempre positivo (el monto a debitar); devuelve { ok, method, mpPaymentId? }.
export async function debitOrCharge(sellerId, amount, { mlOrderId, description }) {
  const balance = await repo.getBalance(sellerId);

  if (balance >= amount) {
    await repo.insertTransaction(sellerId, {
      type: "sale_cost", method: "balance", amount: -Number(amount),
      mlOrderId, description,
    });
    return { ok: true, method: "balance" };
  }

  const card = await repo.getCardInfo(sellerId);
  if (!card?.mp_card_id) {
    return { ok: false, method: "card", reason: "no_card" };
  }

  const result = await cardSvc.chargeSavedCard({
    mpCustomerId:    card.mp_customer_id,
    mpCardId:        card.mp_card_id,
    paymentMethodId: card.mp_card_payment_method_id,
    amount,
    description:     description || "Venta Mercado Libre — Ventaz",
    externalReference: `ml-${mlOrderId}`,
  });

  if (!result.approved) {
    return { ok: false, method: "card", reason: result.status || "rejected" };
  }

  await repo.insertTransaction(sellerId, {
    type: "sale_cost", method: "card", amount: -Number(amount),
    mlOrderId, mpPaymentId: result.mpPaymentId, description,
  });
  return { ok: true, method: "card", mpPaymentId: result.mpPaymentId };
}

// Un solo listado: movimientos de plata reales (cargas y cobros exitosos) + intentos de cobro
// que fallaron (que nunca generan un movimiento de plata, pero el vendedor necesita verlos).
export async function getHistory(sellerId) {
  const [transactions, failedAttempts] = await Promise.all([
    repo.getTransactionHistory(sellerId),
    repo.getFailedChargeAttempts(sellerId),
  ]);

  const merged = [
    ...transactions.map(t => ({
      id: t.id, kind: "transaction", type: t.type, method: t.method,
      amount: Number(t.amount), description: t.description, date: t.created_at,
    })),
    ...failedAttempts.map(a => ({
      id: a.id, kind: "charge_failed", chargeKind: a.kind,
      amount: Number(a.amount), reason: a.reason, date: a.attempted_at,
    })),
  ];

  merged.sort((a, b) => new Date(b.date) - new Date(a.date));
  return merged.slice(0, 50);
}

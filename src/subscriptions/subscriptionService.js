import axios from "axios";
import * as repo from "./subscriptionRepository.js";
import { transporter } from "../config/mailer.js";
import * as listingSvc from "../ml/mlListingService.js";

const NOTIFY_EMAIL = "ventaz.oficial@gmail.com";

async function notifyPlanAttempt(sellerId, planName) {
  try {
    const pool = (await import("../database/db.js")).default;
    const { rows } = await pool.query(`SELECT name, email FROM sellers WHERE id = $1`, [sellerId]);
    const s = rows[0] || {};
    await transporter.sendMail({
      from:    process.env.SMTP_FROM_AWS || "noreply@ventaz.com.ar",
      to:      NOTIFY_EMAIL,
      subject: `🛒 Intento de compra de plan — ${s.name || s.email || sellerId}`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
          <h2 style="color:#f59e0b">Intento de compra de plan</h2>
          <p style="color:#64748b;font-size:14px">Un vendedor inició el proceso de pago de una suscripción.</p>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px 0;color:#64748b">Vendedor</td><td><strong>${s.name || "—"}</strong></td></tr>
            <tr><td style="padding:8px 0;color:#64748b">Email</td><td>${s.email || "—"}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b">Plan solicitado</td><td><strong>${planName}</strong></td></tr>
            <tr><td style="padding:8px 0;color:#64748b">Fecha</td><td>${new Date().toLocaleString("es-AR")}</td></tr>
          </table>
          <p style="color:#94a3b8;font-size:12px;margin-top:16px">El pago todavía no fue confirmado — se notificará por separado cuando MP confirme.</p>
        </div>
      `,
    });
  } catch (e) {
    console.warn("[notify] no se pudo enviar email de intento:", e.message);
  }
}

async function notifyPlanPayment(seller, planName, amount) {
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM_AWS || "noreply@ventaz.com.ar",
      to:   NOTIFY_EMAIL,
      subject: `💳 Nuevo pago de plan — ${seller.name || seller.email}`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
          <h2 style="color:#4db81a">Nuevo pago de suscripción</h2>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px 0;color:#64748b">Vendedor</td><td><strong>${seller.name || "—"}</strong></td></tr>
            <tr><td style="padding:8px 0;color:#64748b">Email</td><td>${seller.email}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b">Plan</td><td><strong>${planName}</strong></td></tr>
            <tr><td style="padding:8px 0;color:#64748b">Monto</td><td><strong>$${Number(amount || 0).toLocaleString("es-AR")}/mes</strong></td></tr>
            <tr><td style="padding:8px 0;color:#64748b">Fecha</td><td>${new Date().toLocaleString("es-AR")}</td></tr>
          </table>
        </div>
      `,
    });
  } catch (e) {
    console.warn("[notify] no se pudo enviar email de pago:", e.message);
  }
}

const MP_BASE = "https://api.mercadopago.com";
const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const BACKEND_URL = process.env.BACKEND_URL;
const FRONTEND_URL = process.env.FRONTEND_URL || process.env.SELLER_APP_URL;

function mpHeaders() {
  return { Authorization: `Bearer ${ACCESS_TOKEN}` };
}

function getBackUrl() {
  if (FRONTEND_URL && !FRONTEND_URL.includes("localhost") && !FRONTEND_URL.includes("127.0.0.1")) {
    return `${FRONTEND_URL}/subscription`;
  }
  return "https://ventaz.com.ar/subscription";
}

// ── Resolución de estado ─────────────────────────────────────

// Nunca debe romper la resolución del estado del plan si Mercado Libre falla — se loguea y
// listo, el pausado se reintenta en el próximo ciclo de todos modos.
function pauseMlListingsQuietly(sellerId) {
  listingSvc.pauseListingsForPlanExpiration(sellerId).catch(err =>
    console.error(`[subscriptions] no se pudieron pausar publicaciones de ML del seller ${sellerId}:`, err.message));
}

export async function resolveStatus(seller) {
  const now = new Date();

  // Trial expirado
  if (seller.plan_status === "trial") {
    const trialEnd = new Date(seller.trial_ends_at);
    if (now > trialEnd) {
      await repo.updateSellerSubscription(seller.id, { plan_status: "expired" });
      pauseMlListingsQuietly(seller.id);
      return { ...seller, plan_status: "expired" };
    }
  }

  // Período pago vencido
  if ((seller.plan_status === "active" || seller.plan_status === "cancelled") && seller.plan_period_end) {
    const periodEnd = new Date(seller.plan_period_end);
    if (now > periodEnd) {
      if (seller.pending_plan_id) {
        // Aplicar downgrade pendiente
        await repo.applyPendingPlan(seller.id, seller.pending_plan_id);
        pauseMlListingsQuietly(seller.id);
        return { ...seller, plan_id: seller.pending_plan_id, plan_status: "expired", pending_plan_id: null };
      } else {
        await repo.updateSellerSubscription(seller.id, { plan_status: "expired" });
        pauseMlListingsQuietly(seller.id);
        return { ...seller, plan_status: "expired" };
      }
    }
  }

  return seller;
}

// ── Obtener o crear plan en MP ───────────────────────────────

async function ensureMpPlan(plan) {
  if (plan.mp_plan_id) {
    console.log(`[sub] usando plan existente mp_plan_id="${plan.mp_plan_id}"`);
    const res = await axios.get(
      `${MP_BASE}/preapproval_plan/${plan.mp_plan_id}`,
      { headers: mpHeaders() }
    );
    return res.data.init_point;
  }

  const notifUrl = `${BACKEND_URL}/seller/purchase/webhook`;
  console.log(`[sub] creando plan en MP para "${plan.name}" — $${plan.price_ars}`);
  const res = await axios.post(
    `${MP_BASE}/preapproval_plan`,
    {
      reason:           `${plan.name} Ventaz`,
      back_url:         getBackUrl(),
      notification_url: notifUrl,
      auto_recurring: {
        frequency:          1,
        frequency_type:     "months",
        transaction_amount: Number(plan.price_ars),
        currency_id:        "ARS",
      },
    },
    { headers: mpHeaders() }
  );

  console.log(`[sub] plan creado id="${res.data.id}" amount="${res.data.auto_recurring?.transaction_amount}"`);
  await repo.savePlanMpId(plan.id, res.data.id);
  return res.data.init_point;
}

// ── Crear suscripción para un vendedor ───────────────────────

export async function createSubscription(sellerId, sellerEmail, planId) {
  if (!ACCESS_TOKEN)
    throw { status: 503, message: "MercadoPago no está configurado" };

  const plan = await repo.getPlanById(planId);
  if (!plan) throw { status: 404, message: "Plan no encontrado" };

  // Primero crear el plan en MP — si falla, no ensuciamos la BD
  const initPoint = await ensureMpPlan(plan);

  // Recién después guardar pending_plan_id para que el webhook lo use
  await repo.updateSellerSubscription(sellerId, { pending_plan_id: planId });

  // Notificar al equipo que alguien inició el proceso de compra
  notifyPlanAttempt(sellerId, plan.name || planId).catch(() => {});

  return { init_point: initPoint };
}

// ── Downgrade programado ─────────────────────────────────────

export async function scheduleDowngrade(sellerId, newPlanId) {
  const plan = await repo.getPlanById(newPlanId);
  if (!plan) throw { status: 404, message: "Plan no encontrado" };

  const current = await repo.getSellerSubscription(sellerId);

  // Cancelar suscripción en MP para que no renueve al precio actual
  // El acceso se mantiene hasta plan_period_end (lo protegemos en el webhook)
  if (current?.mp_subscription_id) {
    await axios.put(
      `${MP_BASE}/preapproval/${current.mp_subscription_id}`,
      { status: "cancelled" },
      { headers: mpHeaders() }
    ).catch(e => console.warn("[sub] no se pudo cancelar en MP:", e.message));
  }

  // Guardar plan pendiente — plan_status NO cambia aquí
  await repo.updateSellerSubscription(sellerId, { pending_plan_id: newPlanId });
  console.log(`[sub] downgrade programado: seller="${sellerId}" → pending="${newPlanId}" (MP cancelado)`);
}

// ── Vincular suscripción luego de volver de MP ───────────────
// El frontend llama esto con el preapproval_id que MP incluye en la back_url

export async function linkSubscription(sellerId, preapprovalId) {
  if (!preapprovalId) return;

  console.log(`[sub] vinculando preapproval="${preapprovalId}" a seller="${sellerId}"`);

  // Consultar MP para obtener estado real y plan correspondiente
  let mpSub;
  try {
    const res = await axios.get(`${MP_BASE}/preapproval/${preapprovalId}`, { headers: mpHeaders() });
    mpSub = res.data;
    console.log(`[sub] preapproval status="${mpSub.status}" plan_id="${mpSub.preapproval_plan_id}"`);
  } catch (e) {
    console.warn("[sub] no se pudo obtener preapproval de MP:", e.message);
  }

  const mpAuthorized = mpSub?.status === "authorized" || mpSub?.status === "active";
  const newStatus = mpAuthorized ? "active" : undefined;

  // Buscar qué plan interno corresponde al mp_plan_id
  let planId;
  if (mpSub?.preapproval_plan_id) {
    const plans = await repo.getPlans();
    const matched = plans.find(p => p.mp_plan_id === mpSub.preapproval_plan_id);
    if (matched) planId = matched.id;
  }

  // Obtener el seller para saber si tiene una suscripción anterior que cancelar
  const currentSeller = await repo.getSellerSubscription(sellerId);
  const oldSubId = currentSeller?.mp_subscription_id;

  // Si venía de trial y el pago fue aceptado, pasar a activo aunque no tengamos el plan_id por mp_plan_id
  const resolvedPlanId = planId || (mpAuthorized && currentSeller?.pending_plan_id) || undefined;
  const resolvedStatus = newStatus || (mpAuthorized && currentSeller?.plan_status === "trial" ? "active" : undefined);

  await repo.updateSellerSubscription(sellerId, {
    mp_subscription_id: preapprovalId,
    ...(resolvedPlanId ? { plan_id:     resolvedPlanId, clear_pending: true } : {}),
    ...(resolvedStatus ? { plan_status: resolvedStatus } : {}),
  });

  // Cancelar suscripción anterior si existe y es diferente a la nueva
  if (oldSubId && oldSubId !== preapprovalId && newStatus === "active") {
    console.log(`[sub] cancelando suscripción anterior="${oldSubId}"`);
    await axios.put(
      `${MP_BASE}/preapproval/${oldSubId}`,
      { status: "cancelled" },
      { headers: mpHeaders() }
    ).catch(e => console.warn("[sub] no se pudo cancelar suscripción anterior:", e.message));
  }

  console.log(`[sub] ✓ seller="${sellerId}" actualizado → plan="${planId}" status="${newStatus}"`);
}

// ── Cancelar suscripción ─────────────────────────────────────

async function cancelMpSubscription(mpSubId) {
  await axios.put(
    `${MP_BASE}/preapproval/${mpSubId}`,
    { status: "cancelled" },
    { headers: mpHeaders() }
  );
}

export async function cancelSubscription(sellerId) {
  const current = await repo.getSellerSubscription(sellerId);
  if (!current) throw { status: 404, message: "No se encontró la suscripción" };

  if (!current.mp_subscription_id)
    throw { status: 400, message: "No tenés una suscripción activa para cancelar" };

  if (current.plan_status === "cancelled")
    throw { status: 400, message: "La suscripción ya está cancelada" };

  await cancelMpSubscription(current.mp_subscription_id);

  await repo.updateSellerSubscription(sellerId, { plan_status: "cancelled" });

  return { message: "Suscripción cancelada. Conservás el acceso hasta el final del período." };
}

// ── Webhook de MercadoPago ───────────────────────────────────

export async function handleWebhook(type, dataId) {
  // subscription_authorized_payment = cobro real de una suscripción
  if (type === "subscription_authorized_payment") {
    return handleAuthorizedPaymentWebhook(dataId);
  }
  if (type !== "subscription_preapproval") return;

  console.log(`[sub-webhook] consultando preapproval id="${dataId}"`);

  let mpSub;
  try {
    const res = await axios.get(`${MP_BASE}/preapproval/${dataId}`, { headers: mpHeaders() });
    mpSub = res.data;
  } catch (e) {
    console.error("[sub-webhook] ✗ no se pudo obtener preapproval:", e.response?.data || e.message);
    throw { status: 400, message: "No se pudo obtener la suscripción de MP" };
  }

  const payerEmail = mpSub.payer_email || mpSub.payer?.email;
  console.log("[sub-webhook] preapproval COMPLETO:", JSON.stringify(mpSub, null, 2));

  // Buscar vendedor: primero por mp_subscription_id, luego por payer_email
  let seller = await repo.findSellerByMpSubscriptionId(dataId);
  console.log(`[sub-webhook] buscar por mp_subscription_id="${dataId}":`, seller ? `encontrado (${seller.email})` : "no encontrado");

  if (!seller && payerEmail) {
    seller = await repo.findSellerByEmail(payerEmail.toLowerCase());
    console.log(`[sub-webhook] buscar por email="${payerEmail}":`, seller ? `encontrado (${seller.id})` : "no encontrado");
  }

  // Fallback: buscar por el plan al que se suscribió recientemente (sin mp_subscription_id aún)
  if (!seller && mpSub.preapproval_plan_id) {
    const plans = await repo.getPlans();
    const matched = plans.find(p => p.mp_plan_id === mpSub.preapproval_plan_id);
    if (matched) {
      seller = await repo.findSellerByPendingPlan(matched.id);
      console.log(`[sub-webhook] buscar por plan pendiente "${matched.id}":`, seller ? `encontrado (${seller.id})` : "no encontrado");
    }
  }

  if (!seller) {
    console.warn("[sub-webhook] ✗ vendedor no encontrado — ignorando");
    return;
  }

  const mpStatus    = mpSub.status;
  const nextPayment = mpSub.next_payment_date ? new Date(mpSub.next_payment_date) : null;

  let newStatus;
  switch (mpStatus) {
    case "authorized": newStatus = "active";          break;
    case "paused":     newStatus = "pending_payment"; break;
    case "cancelled":  newStatus = "cancelled";       break;
    default:
      console.log(`[sub-webhook] status="${mpStatus}" no requiere acción`);
      return;
  }

  // Si MP cancela pero hay un downgrade pendiente Y el período aún no venció,
  // mantenemos plan_status = "active" (el usuario pagó hasta plan_period_end)
  if (newStatus === "cancelled" && seller.pending_plan_id && seller.plan_period_end) {
    const periodEnd = new Date(seller.plan_period_end);
    if (new Date() < periodEnd) {
      console.log(`[sub-webhook] cancelación por downgrade — manteniendo acceso hasta ${periodEnd.toISOString()}`);
      newStatus = "active"; // acceso garantizado hasta period_end
    }
  }

  const updates = {
    mp_subscription_id: dataId,
    plan_status:        newStatus,
    plan_period_end:    nextPayment || seller.plan_period_end, // conservar period_end si MP no lo manda
  };

  // Cuando se confirma pago nuevo (authorized), aplicar el pending_plan_id si existe
  if (newStatus === "active" && seller.pending_plan_id && mpStatus === "authorized") {
    console.log(`[sub-webhook] nuevo pago autorizado → aplicando pending_plan="${seller.pending_plan_id}"`);
    updates.plan_id       = seller.pending_plan_id;
    updates.clear_pending = true;

    // Cancelar la suscripción anterior en MP para que no siga cobrando
    const oldSubId = seller.mp_subscription_id;
    if (oldSubId && oldSubId !== dataId) {
      console.log(`[sub-webhook] cancelando suscripción anterior="${oldSubId}"`);
      await axios.put(
        `${MP_BASE}/preapproval/${oldSubId}`,
        { status: "cancelled" },
        { headers: mpHeaders() }
      ).catch(e => console.warn("[sub-webhook] no se pudo cancelar suscripción anterior:", e.message));
    }
  }

  console.log(`[sub-webhook] actualizando seller="${seller.id}" → status="${newStatus}"`);
  await repo.updateSellerSubscription(seller.id, updates);
  console.log(`[sub-webhook] ✓ seller actualizado`);

  if (newStatus === "active") {
    const planId = updates.plan_id || seller.plan_id;
    repo.getPlanById(planId)
      .then(plan => notifyPlanPayment(seller, plan?.name || planId, plan?.price_ars || mpSub.auto_recurring?.transaction_amount))
      .catch(() => {});
    listingSvc.reactivateListingsAfterPlanRenewal(seller.id).catch(err =>
      console.error(`[sub-webhook] no se pudieron reactivar publicaciones de ML del seller ${seller.id}:`, err.message));
  }
}

// ── Webhook de pagos individuales ───────────────────────────

export async function handlePaymentWebhook(paymentId) {
  let payment;
  try {
    const res = await axios.get(`${MP_BASE}/v1/payments/${paymentId}`, { headers: mpHeaders() });
    payment = res.data;
  } catch {
    return;
  }

  const preapprovalId = payment.subscription_id || payment.preapproval_id;
  console.log(`[pay-webhook] payment=${paymentId} status="${payment.status}" preapproval="${preapprovalId}"`);

  if (!preapprovalId) {
    console.log("[pay-webhook] no es pago de suscripción — ignorado");
    return;
  }

  // Buscar vendedor por mp_subscription_id (guardado cuando se creó el preapproval)
  let seller = await repo.findSellerByMpSubscriptionId(preapprovalId);

  // Fallback: buscar por external_reference (= sellerId)
  if (!seller && payment.external_reference) {
    seller = await repo.findSellerById(payment.external_reference);
    console.log(`[pay-webhook] buscar por external_reference="${payment.external_reference}":`, seller ? "encontrado" : "no encontrado");
  }

  if (!seller) {
    console.warn(`[pay-webhook] ✗ vendedor no encontrado para preapproval="${preapprovalId}"`);
    return;
  }

  console.log(`[pay-webhook] seller="${seller.id}" plan="${seller.plan_id}"`);

  const statusMap = { approved: "approved", rejected: "rejected", cancelled: "cancelled" };
  const status = statusMap[payment.status] || payment.status;

  // Si el pago fue aprobado, activar el plan
  if (payment.status === "approved") {
    await repo.updateSellerSubscription(seller.id, {
      mp_subscription_id: preapprovalId,
      plan_status:        "active",
      plan_id:            seller.plan_id,
    });
    console.log(`[pay-webhook] ✓ plan activado para seller="${seller.id}"`);
    const plan = await repo.getPlanById(seller.plan_id);
    await notifyPlanPayment(seller, plan?.name || seller.plan_id, payment.transaction_amount);
    listingSvc.reactivateListingsAfterPlanRenewal(seller.id).catch(err =>
      console.error(`[pay-webhook] no se pudieron reactivar publicaciones de ML del seller ${seller.id}:`, err.message));
  }

  // Guardar registro del pago en historial
  await repo.savePayment(seller.id, {
    mpPaymentId:  String(payment.id),
    planId:       seller.plan_id,
    amount:       payment.transaction_amount,
    status,
    paymentDate:  payment.date_approved || payment.date_created,
  });
}

// ── Estado de la suscripción para el frontend ────────────────

export async function getSubscriptionStatus(sellerId) {
  let data = await repo.getSellerSubscription(sellerId);
  if (!data) throw { status: 404, message: "No encontrado" };

  const resolved = await resolveStatus(data);

  const plans = await repo.getPlans();

  const payments = await repo.getPaymentHistory(sellerId);

  return {
    current: {
      plan_id:            resolved.plan_id,
      plan_name:          resolved.plan_name,
      plan_status:        resolved.plan_status,
      price_ars:          resolved.price_ars,
      trial_ends_at:      resolved.trial_ends_at,
      plan_period_end:    resolved.plan_period_end,
      mp_subscription_id: resolved.mp_subscription_id,
      pending_plan_id:    resolved.pending_plan_id,
    },
    plans,
    payments,
  };
}

// ── Webhook de cobro de suscripción (subscription_authorized_payment) ──

async function handleAuthorizedPaymentWebhook(authorizedPaymentId) {
  console.log(`[auth-pay-webhook] id="${authorizedPaymentId}"`);

  let authPayment;
  try {
    const res = await axios.get(
      `${MP_BASE}/authorized_payments/${authorizedPaymentId}`,
      { headers: mpHeaders() }
    );
    authPayment = res.data;
  } catch (e) {
    console.warn("[auth-pay-webhook] no se pudo obtener authorized_payment:", e.message);
    return;
  }

  const preapprovalId = authPayment.preapproval_id;
  if (!preapprovalId) return;

  const seller = await repo.findSellerByMpSubscriptionId(preapprovalId);
  if (!seller) {
    console.warn(`[auth-pay-webhook] vendedor no encontrado para preapproval="${preapprovalId}"`);
    return;
  }

  const status = authPayment.status === "processed" ? "approved"
               : authPayment.status === "recycling"  ? "rejected"
               : authPayment.status || "unknown";

  await repo.savePayment(seller.id, {
    mpPaymentId:  String(authPayment.id),
    planId:       seller.plan_id,
    amount:       authPayment.transaction_amount,
    status,
    paymentDate:  authPayment.date_created,
  });

  // Actualizar plan_period_end si el pago fue aprobado
  if (status === "approved") {
    await repo.updateSellerSubscription(seller.id, {
      plan_status:     "active",
      ...(authPayment.next_payment_date ? { plan_period_end: new Date(authPayment.next_payment_date) } : {}),
    });
    const plan = await repo.getPlanById(seller.plan_id);
    await notifyPlanPayment(seller, plan?.name || seller.plan_id, authPayment.transaction_amount);
  }

  console.log(`[auth-pay-webhook] ✓ pago guardado seller="${seller.id}" status="${status}"`);
}

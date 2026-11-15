// Cobro con tarjeta guardada para las ventas de Mercado Libre — usa la API de
// Customers & Cards de MercadoPago, distinta de la de Preapproval que usa subscriptionService.js
// (esa es para montos fijos recurrentes; acá necesitamos cobrar montos variables bajo demanda).
import axios from "axios";
import crypto from "crypto";

const MP_BASE      = "https://api.mercadopago.com";
const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

// Monto de la autorización de verificación para las marcas que no admiten la validación con
// monto 0 (ver ZERO_AMOUNT_VALIDATION_METHODS) — se autoriza y se cancela en el acto, nunca se
// cobra de verdad. PROVISORIO, cualquier monto chico sirve.
const CARD_VERIFICATION_AMOUNT = 100;

// Marcas donde Mercado Pago admite la "validación con monto 0" (header X-Card-Validation) — según
// su documentación solo Visa y Mastercard, crédito/débito/prepaga. No cobra ni retiene nada,
// a diferencia de la autorización de $100, que además NO existe para tarjetas de débito
// (error 2077 "Deferred capture not supported": GET /v1/payment_methods las marca con
// deferred_capture "unsupported") — por eso antes todas las tarjetas de débito se rechazaban acá.
const ZERO_AMOUNT_VALIDATION_METHODS = new Set(["visa", "master", "debvisa", "debmaster"]);

const MSG_NOT_VERIFIED = "No pudimos validar esta tarjeta. Probá con otra tarjeta.";
const MSG_NOT_ALLOWED  = "Esta tarjeta no admite débito automático. Probá con otra tarjeta.";

function mpHeaders(extra = {}) {
  return { Authorization: `Bearer ${ACCESS_TOKEN}`, ...extra };
}

function idempotencyHeaders(extra = {}) {
  return mpHeaders({ "X-Idempotency-Key": crypto.randomUUID(), ...extra });
}

function zeroAmountHeaders() {
  return idempotencyHeaders({ "X-Card-Validation": "card_validation", "X-Expand-Response-Nodes": "gateway.reference" });
}

// Motivo legible de un error de Mercado Pago (los de validación vienen con message/cause, los de
// red solo con err.message).
function mpReason(err) {
  const d = err.response?.data;
  return d?.message || d?.cause?.[0]?.description || err.message;
}

async function findOrCreateCustomer(sellerEmail) {
  const search = await axios.get(`${MP_BASE}/v1/customers/search`, {
    headers: mpHeaders(),
    params:  { email: sellerEmail },
  });
  if (search.data.results?.length > 0) return search.data.results[0].id;

  const created = await axios.post(
    `${MP_BASE}/v1/customers`,
    { email: sellerEmail },
    { headers: mpHeaders() }
  );
  return created.data.id;
}

// Cancela una autorización sin capturar para liberar el monto retenido. Mercado Pago solo deja
// cancelar pagos en pending/in_process/authorized, así que antes de cada intento se consulta el
// estado real, y si falla se reintenta — antes un único PUT fallido dejaba los $100 retenidos en
// la tarjeta del vendedor hasta que la autorización vencía (7 días), y el error quedaba solo en el
// log. Devuelve true si la autorización quedó cancelada.
async function cancelAuthorization(paymentId) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { data } = await axios.get(`${MP_BASE}/v1/payments/${paymentId}`, { headers: mpHeaders() });
      if (data.status === "cancelled") return true;
      if (!["pending", "in_process", "authorized"].includes(data.status)) {
        console.error(`[mlCardService] la autorización ${paymentId} está en "${data.status}/${data.status_detail}": no es cancelable`);
        return false;
      }
      await axios.put(`${MP_BASE}/v1/payments/${paymentId}`, { status: "cancelled" }, { headers: mpHeaders() });
      return true;
    } catch (err) {
      console.error(`[mlCardService] no se pudo cancelar la autorización ${paymentId} (intento ${attempt}/3):`, err.response?.data || err.message);
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  return false;
}

// Valida que la tarjeta sea real, con el MISMO token que generó el SDK en el frontend (con el CVV
// que tipeó el vendedor, que está presente). Sin cobrar nada:
//   - Visa/Mastercard (crédito, débito y prepaga): validación con monto 0, que además deja
//     registrada la tarjeta como "credencial guardada" (point_of_interaction) para cuando la
//     aplicación esté habilitada para Pagos Automáticos.
//   - Resto de las marcas: autorización de $100 sin capturar y cancelación inmediata.
async function verifyCard({ mpCustomerId, cardToken, paymentMethodId, externalReference }) {
  const zeroAmount = ZERO_AMOUNT_VALIDATION_METHODS.has(paymentMethodId);
  try {
    const payment = await axios.post(
      `${MP_BASE}/v1/payments`,
      zeroAmount
        ? {
            transaction_amount: 0,
            token:              cardToken,
            payment_method_id:  paymentMethodId,
            payer:              { type: "customer", id: mpCustomerId },
            point_of_interaction: {
              type:     "CREDENTIAL_ON_FILE",
              sub_type: "unscheduled",
              transaction_data: { first_transaction: true, storage: "store", transaction_initiator: "customer" },
            },
          }
        : {
            transaction_amount: CARD_VERIFICATION_AMOUNT,
            token:              cardToken,
            description:        "Verificación de tarjeta — Ventaz",
            installments:       1,
            payment_method_id:  paymentMethodId,
            payer:              { type: "customer", id: mpCustomerId },
            external_reference: externalReference,
            capture:            false, // solo autoriza, no cobra
          },
      { headers: zeroAmount ? zeroAmountHeaders() : idempotencyHeaders() }
    );

    const authorized = payment.data.status === "authorized" || payment.data.status === "approved";
    if (authorized && payment.data.id && !zeroAmount) await cancelAuthorization(payment.data.id);
    return { verified: authorized, reason: payment.data.status_detail || payment.data.status };
  } catch (err) {
    console.error("[mlCardService] verifyCard error:", err.response?.data || err.message);
    return { verified: false, reason: mpReason(err) };
  }
}

// Token SIN CVV a partir de la tarjeta ya guardada — el mismo que usa chargeSavedCard.
async function offSessionToken(mpCustomerId, mpCardId) {
  const cardToken = await axios.post(
    `${MP_BASE}/v1/card_tokens`,
    { card_id: mpCardId, customer_id: mpCustomerId },
    { headers: mpHeaders() }
  );
  return cardToken.data.id;
}

// La verificación de arriba (verifyCard) usa el token CON el CVV que tipeó el vendedor — confirma
// que la tarjeta es real, pero NO lo que Ventaz realmente necesita: poder cobrarla más adelante SIN
// el vendedor presente (débito automático de ventas de ML). Ese cobro usa un token distinto (armado
// solo con card_id+customer_id, sin CVV — ver chargeSavedCard), y Mercado Pago lo rechaza con
// 3031 "security_code_id can't be null" cuando el medio de pago exige el código en cada pago:
// según GET /v1/payment_methods eso pasa con Visa, Amex, Cabal, Argencard, Diners y TODAS las
// tarjetas de débito; solo Mastercard (crédito/prepaga) y Naranja lo tienen como opcional. No hay
// forma de saberlo de antemano para cada BIN, así que se prueba de verdad, igual que el cobro real:
//   - Visa/Mastercard: validación con monto 0 usando el token sin CVV (no retiene nada). Si falla
//     por una razón distinta de la del CVV, se prueba además con la autorización de $100.
//   - Resto de las marcas: autorización de $100 sin capturar y cancelación inmediata.
async function verifyOffSessionCharging({ mpCustomerId, mpCardId, paymentMethodId, externalReference }) {
  if (ZERO_AMOUNT_VALIDATION_METHODS.has(paymentMethodId)) {
    try {
      const token = await offSessionToken(mpCustomerId, mpCardId);
      const check = await axios.post(
        `${MP_BASE}/v1/payments`,
        {
          transaction_amount: 0,
          token,
          payment_method_id:  paymentMethodId,
          payer:              { type: "customer", id: mpCustomerId },
        },
        { headers: zeroAmountHeaders() }
      );
      if (check.data.status === "approved") return { ok: true };
    } catch (err) {
      const reason = mpReason(err);
      console.error("[mlCardService] validación sin CVV (monto 0) rechazada:", err.response?.data || err.message);
      // El CVV es obligatorio para este medio de pago: no hay nada más que probar.
      if (/security_code/i.test(reason)) return { ok: false, reason };
    }
  }

  let cardTokenId;
  try {
    cardTokenId = await offSessionToken(mpCustomerId, mpCardId);
  } catch (err) {
    console.error("[mlCardService] no se pudo generar el token fuera de sesión:", err.response?.data || err.message);
    return { ok: false, reason: "token" };
  }

  try {
    const payment = await axios.post(
      `${MP_BASE}/v1/payments`,
      {
        transaction_amount: CARD_VERIFICATION_AMOUNT,
        token:              cardTokenId,
        description:        "Verificación de cobro automático — Ventaz",
        installments:       1,
        payment_method_id:  paymentMethodId,
        payer:              { type: "customer", id: mpCustomerId },
        external_reference: externalReference,
        capture:            false,
      },
      { headers: idempotencyHeaders() }
    );

    const authorized = payment.data.status === "authorized" || payment.data.status === "approved";
    if (authorized && payment.data.id) await cancelAuthorization(payment.data.id);
    return authorized ? { ok: true } : { ok: false, reason: payment.data.status_detail || payment.data.status };
  } catch (err) {
    console.error("[mlCardService] verifyOffSessionCharging error:", err.response?.data || err.message);
    return { ok: false, reason: mpReason(err) };
  }
}

// Se llama con el card_token que generó el SDK de MP en el frontend (nunca el número de tarjeta crudo).
// Además de guardarla, verifica (sin cobrar nada) que la tarjeta sea real y que se pueda cobrar
// después sin el vendedor presente — si cualquiera de las dos falla, no queda guardada y el
// vendedor ve "probá con otra tarjeta".
export async function saveCard(sellerEmail, cardToken) {
  const customerId = await findOrCreateCustomer(sellerEmail);

  const card = await axios.post(
    `${MP_BASE}/v1/customers/${customerId}/cards`,
    { token: cardToken },
    { headers: mpHeaders() }
  );

  const result = {
    mpCustomerId:    customerId,
    mpCardId:        card.data.id,
    lastFour:        card.data.last_four_digits,
    paymentMethodId: card.data.payment_method?.id,
  };

  const removeCard = () =>
    axios.delete(`${MP_BASE}/v1/customers/${customerId}/cards/${result.mpCardId}`, { headers: mpHeaders() }).catch(() => {});

  const verification = await verifyCard({
    mpCustomerId:    result.mpCustomerId,
    cardToken,
    paymentMethodId: result.paymentMethodId,
    externalReference: `card-verify-${customerId}-${Date.now()}`,
  });

  if (!verification.verified) {
    // La tarjeta no pasó la verificación — la sacamos de MP para no dejarla asociada sin validar.
    await removeCard();
    const err = new Error(failureMessage(verification.reason, MSG_NOT_VERIFIED));
    err.status = 402;
    throw err;
  }

  const offSession = await verifyOffSessionCharging({
    mpCustomerId:    result.mpCustomerId,
    mpCardId:        result.mpCardId,
    paymentMethodId: result.paymentMethodId,
    externalReference: `card-offsession-check-${customerId}-${Date.now()}`,
  });

  if (!offSession.ok) {
    await removeCard();
    const err = new Error(failureMessage(offSession.reason, MSG_NOT_ALLOWED));
    err.status = 402;
    throw err;
  }

  return result;
}

// Traduce el motivo real de un rechazo de Mercado Pago a algo accionable para el vendedor.
// `reason` puede ser un status_detail de pago rechazado (ej. cc_rejected_insufficient_amount) o
// el mensaje crudo de un error de validación (ej. "security_code_id can't be null" — pasa
// cuando el emisor exige CVV en cada cobro y no soporta cobro fuera de sesión).
const REJECTION_MESSAGES = {
  cc_rejected_insufficient_amount:      "La tarjeta no tiene fondos suficientes para este monto.",
  cc_rejected_bad_filled_security_code: "El código de seguridad es incorrecto.",
  cc_rejected_bad_filled_date:          "La fecha de vencimiento es incorrecta.",
  cc_rejected_bad_filled_card_number:   "El número de tarjeta es incorrecto.",
  cc_rejected_card_disabled:            "La tarjeta está deshabilitada — llamá a tu banco para activarla.",
  cc_rejected_call_for_authorize:       "Tu banco rechazó el cobro — llamá a tu banco para autorizarlo.",
  cc_rejected_duplicated_payment:       "Ya se hizo un cobro igual hace poco — esperá unos minutos y probá de nuevo.",
  cc_rejected_max_attempts:             "Se superó el número de intentos permitidos con esta tarjeta.",
  cc_rejected_card_type_not_allowed:    "Este tipo de tarjeta no está permitido para cobro automático.",
  cc_rejected_high_risk:                "Mercado Pago rechazó el cobro por seguridad — probá con otra tarjeta.",
};

// Mensaje para el vendedor al fallar la verificación al guardar: el motivo conocido de rechazo
// (fondos, fecha, etc.) si lo hay; si no, el mensaje genérico de "probá con otra tarjeta".
function failureMessage(reason, fallback) {
  return REJECTION_MESSAGES[reason] || fallback;
}

export function translateChargeFailure(reason) {
  if (!reason) return "No se pudo cobrar la tarjeta. Probá con otra o revisá el saldo.";
  if (REJECTION_MESSAGES[reason]) return REJECTION_MESSAGES[reason];
  if (String(reason).includes("security_code_id")) {
    return "El tipo de tarjeta no es válido para cobro automático. Guardá una tarjeta de otro banco o emisor.";
  }
  return "No se pudo cobrar la tarjeta. Probá con otra o revisá el saldo.";
}

// Cobra un monto exacto a la tarjeta guardada, sin CVV (cobro automático fuera de sesión,
// igual que cualquier cobro recurrente merchant-initiated).
export async function chargeSavedCard({ mpCustomerId, mpCardId, paymentMethodId, amount, description, externalReference }) {
  const cardToken = await axios.post(
    `${MP_BASE}/v1/card_tokens`,
    { card_id: mpCardId, customer_id: mpCustomerId },
    { headers: mpHeaders() }
  );

  try {
    const payment = await axios.post(
      `${MP_BASE}/v1/payments`,
      {
        transaction_amount: Number(amount),
        token:              cardToken.data.id,
        description,
        installments:       1,
        payment_method_id:  paymentMethodId,
        payer:              { type: "customer", id: mpCustomerId },
        external_reference: externalReference,
      },
      { headers: idempotencyHeaders() }
    );

    return {
      approved:    payment.data.status === "approved",
      status:      payment.data.status,
      reason:      payment.data.status_detail || null,
      mpPaymentId: payment.data.id ? String(payment.data.id) : null,
    };
  } catch (err) {
    const detail = err.response?.data;
    console.error("[mlCardService] chargeSavedCard error:", detail || err.message);
    return {
      approved:    false,
      status:      "error",
      reason:      detail?.message || detail?.cause?.[0]?.description || err.message,
      mpPaymentId: null,
    };
  }
}

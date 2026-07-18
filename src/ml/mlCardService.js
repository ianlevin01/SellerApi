// Cobro con tarjeta guardada para las ventas de Mercado Libre — usa la API de
// Customers & Cards de MercadoPago, distinta de la de Preapproval que usa subscriptionService.js
// (esa es para montos fijos recurrentes; acá necesitamos cobrar montos variables bajo demanda).
import axios from "axios";
import crypto from "crypto";

const MP_BASE      = "https://api.mercadopago.com";
const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

// Monto de la autorización de verificación al guardar una tarjeta — se autoriza y se
// cancela en el acto, nunca se cobra de verdad. PROVISORIO, cualquier monto chico sirve.
const CARD_VERIFICATION_AMOUNT = 100;

function mpHeaders(extra = {}) {
  return { Authorization: `Bearer ${ACCESS_TOKEN}`, ...extra };
}

function idempotencyHeaders() {
  return mpHeaders({ "X-Idempotency-Key": crypto.randomUUID() });
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

// Autoriza un monto chico contra la tarjeta y lo cancela en el acto — confirma que la
// tarjeta es real y tiene fondos, sin cobrar nada de verdad (capture: false + cancelación).
async function verifyCard({ mpCustomerId, mpCardId, paymentMethodId, externalReference }) {
  const cardToken = await axios.post(
    `${MP_BASE}/v1/card_tokens`,
    { card_id: mpCardId, customer_id: mpCustomerId },
    { headers: mpHeaders() }
  );

  const payment = await axios.post(
    `${MP_BASE}/v1/payments`,
    {
      transaction_amount: CARD_VERIFICATION_AMOUNT,
      token:              cardToken.data.id,
      description:        "Verificación de tarjeta — Ventaz",
      installments:       1,
      payment_method_id:  paymentMethodId,
      payer:              { type: "customer", id: mpCustomerId },
      external_reference: externalReference,
      capture:            false, // solo autoriza, no cobra
    },
    { headers: idempotencyHeaders() }
  ).catch(err => {
    console.error("[mlCardService] verifyCard error:", err.response?.data || err.message);
    return { data: { status: "rejected", id: null } };
  });

  const authorized = payment.data.status === "authorized" || payment.data.status === "approved";

  // Si quedó autorizado, cancelamos de inmediato para liberar el monto retenido sin cobrar nada.
  if (authorized && payment.data.id) {
    await axios.put(
      `${MP_BASE}/v1/payments/${payment.data.id}`,
      { status: "cancelled" },
      { headers: mpHeaders() }
    ).catch(err => console.error("[mlCardService] no se pudo cancelar la autorización de verificación:", err.response?.data || err.message));
  }

  return { verified: authorized, status: payment.data.status };
}

// Se llama con el card_token que generó el SDK de MP en el frontend (nunca el número de tarjeta crudo).
// Además de guardarla, hace una autorización chica (y la cancela) para confirmar que la
// tarjeta es real y tiene fondos — si falla, no queda guardada.
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

  const verification = await verifyCard({
    mpCustomerId:    result.mpCustomerId,
    mpCardId:        result.mpCardId,
    paymentMethodId: result.paymentMethodId,
    externalReference: `card-verify-${customerId}-${Date.now()}`,
  });

  if (!verification.verified) {
    // La tarjeta no pasó la verificación — la sacamos de MP para no dejarla asociada sin validar.
    await axios.delete(`${MP_BASE}/v1/customers/${customerId}/cards/${result.mpCardId}`, { headers: mpHeaders() }).catch(() => {});
    const err = new Error("La tarjeta no pudo verificarse. Probá con otra o revisá los datos.");
    err.status = 402;
    throw err;
  }

  return result;
}

// Cobra un monto exacto a la tarjeta guardada, sin CVV (cobro automático fuera de sesión,
// igual que cualquier cobro recurrente merchant-initiated).
export async function chargeSavedCard({ mpCustomerId, mpCardId, paymentMethodId, amount, description, externalReference }) {
  const cardToken = await axios.post(
    `${MP_BASE}/v1/card_tokens`,
    { card_id: mpCardId, customer_id: mpCustomerId },
    { headers: mpHeaders() }
  );

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
  ).catch(err => {
    console.error("[mlCardService] chargeSavedCard error:", err.response?.data || err.message);
    return { data: { status: "rejected", id: null } };
  });

  return {
    approved:    payment.data.status === "approved",
    status:      payment.data.status,
    mpPaymentId: payment.data.id ? String(payment.data.id) : null,
  };
}

// src/modules/checkout/checkoutRoutes.js
import { Router }  from "express";
import crypto       from "crypto";
import requireSeller from "../middleware/requireSeller.js";
import * as checkoutService from "./purchaseService.js";
import { handleWebhook as handleSubscriptionWebhook, handlePaymentWebhook } from "../subscriptions/subscriptionService.js";

const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET; // clave secreta del panel de MP

function verifyMpSignature(req) {
  if (!MP_WEBHOOK_SECRET) return true; // si no está configurada, no bloqueamos (dev)

  const xSignature  = req.headers["x-signature"]  || "";
  const xRequestId  = req.headers["x-request-id"] || "";
  const dataId      = req.query["data.id"]         || req.body?.data?.id || "";

  // Extraer ts y v1 del header x-signature: "ts=...,v1=..."
  const parts = Object.fromEntries(xSignature.split(",").map(p => p.split("=")));
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const expected = crypto
    .createHmac("sha256", MP_WEBHOOK_SECRET)
    .update(manifest)
    .digest("hex");

  return crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}

const router = Router();


router.post("/public/:slug/checkout", async (req, res) => {
  try {
    const { customer, items, shipping } = req.body;
    const { slug } = req.params;

    const result = await checkoutService.createCheckout({
      slug,
      customer,
      items,
      shipping,
      seller: req.seller,
    });
    return res.json(result);
  } catch (err) {
    console.error("[checkout] error:", err?.message, err?.cause ?? err);
    if (err.status) return res.status(err.status).json({ message: err.message });
    return res.status(500).json({ message: "Error interno" });
  }
});

// Confirmación desde el front cuando MP redirige de vuelta (back_url)
router.get("/confirm", async (req, res) => {
  const { payment_id } = req.query;
  if (!payment_id) return res.status(400).json({ message: "payment_id requerido" });

  try {
    const result = await checkoutService.confirmPayment(payment_id);
    return res.json(result);
  } catch (err) {
    console.error("[confirm] error:", err?.message);
    if (err.status) return res.status(err.status).json({ message: err.message });
    return res.status(500).json({ message: "No se pudo verificar el pago" });
  }
});

// Webhook de Mercado Pago — sin auth, MP lo llama directamente
router.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  const type   = req.query.type   || req.body?.type;
  const dataId = req.query["data.id"] || req.body?.data?.id;

  console.log(`\n[webhook] ← MP type="${type}" id="${dataId}"`);
  console.log("[webhook] headers:", JSON.stringify({
    "x-signature":  req.headers["x-signature"]  || "(none)",
    "x-request-id": req.headers["x-request-id"] || "(none)",
  }));
  console.log("[webhook] body:", JSON.stringify(req.body));
  console.log("[webhook] query:", JSON.stringify(req.query));

  if (!verifyMpSignature(req)) {
    console.warn("[webhook] ✗ firma inválida — request ignorado");
    return;
  }
  console.log("[webhook] ✓ firma válida (o MP_WEBHOOK_SECRET no configurado)");

  try {
    if (type === "subscription_preapproval" || type === "subscription_authorized_payment") {
      console.log("[webhook] → procesando como suscripción");
      await handleSubscriptionWebhook(type, dataId);
      console.log("[webhook] ✓ suscripción procesada");
    } else if (type === "payment") {
      console.log("[webhook] → procesando como pago");
      await handlePaymentWebhook(dataId).catch(e => console.warn("[webhook] pago-suscripción ignorado:", e.message));
      await checkoutService.handleWebhook(req.query, req.body);
      console.log("[webhook] ✓ pago procesado");
    } else {
      console.log(`[webhook] tipo "${type}" no manejado — delegando a checkout`);
      await checkoutService.handleWebhook(req.query, req.body);
    }
  } catch (err) {
    console.error("[webhook] ✗ error:", err.message, err.stack);
  }
});

export default router;
// src/modules/checkout/checkoutRoutes.js
import { Router } from "express";
import requireSeller from "../middleware/requireSeller.js";
import * as checkoutService from "./purchaseService.js";

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
  console.log("llego")
  try {
    await checkoutService.handleWebhook(req.query, req.body);
    return res.sendStatus(200);
  } catch (err) {
    console.error(err);
    return res.sendStatus(500);
  }
});

export default router;
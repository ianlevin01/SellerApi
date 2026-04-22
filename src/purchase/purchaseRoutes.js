// src/modules/checkout/checkoutRoutes.js
import { Router } from "express";
import requireSeller from "../middleware/requireSeller.js";
import * as checkoutService from "./checkoutService.js";

const router = Router();

// Crear checkout
router.post("/create", requireSeller, async (req, res) => {
  try {
    const { items } = req.body; // [{ product_id, quantity }]
    const sellerId = req.seller.id;

    const result = await checkoutService.createCheckout(sellerId, items);
    return res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// Webhook Mercado Pago
router.post("/webhook", async (req, res) => {
  try {
    await checkoutService.handleWebhook(req.body);
    return res.sendStatus(200);
  } catch (err) {
    console.error(err);
    return res.sendStatus(500);
  }
});

export default router;
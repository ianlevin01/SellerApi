import { Router } from "express";
import requireSeller from "../middleware/requireSeller.js";
import * as ctrl from "./subscriptionController.js";

const router = Router();

// Webhook sin auth (MP lo llama directamente)
router.post("/webhook", ctrl.webhook);

// Return desde MP tras autorizar suscripción → redirige al frontend con preapproval_id
router.get("/return", (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const preapprovalId = req.query.preapproval_id || req.query.subscription_id || "";
  const extra = preapprovalId ? `&preapproval_id=${preapprovalId}` : "";
  res.redirect(`${frontendUrl}/subscription?result=ok${extra}`);
});

// Rutas autenticadas
router.use(requireSeller);
router.get("/status",             ctrl.getStatus);
router.post("/subscribe",          ctrl.subscribe);
router.post("/cancel",             ctrl.cancel);
router.post("/link",               ctrl.link);
router.post("/schedule-downgrade", ctrl.scheduleDowngrade);

export default router;

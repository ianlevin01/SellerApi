import { Router } from "express";
import requireSeller from "../middleware/requireSeller.js";
import requireAdmin  from "../middleware/requireAdmin.js";
import * as service  from "./payoutsService.js";

const router = Router();

// ── Vendedor ──────────────────────────────────────────────────

router.get("/summary", requireSeller, async (req, res) => {
  try {
    const data = await service.getSummary(req.seller.id);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

router.put("/cvu", requireSeller, async (req, res) => {
  try {
    const { cvu, alias, holderName } = req.body;
    const result = await service.saveCvu(req.seller.id, { cvu, alias, holderName });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

router.post("/request", requireSeller, async (req, res) => {
  try {
    const payout = await service.requestPayout(req.seller.id);
    res.json(payout);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// ── Admin ─────────────────────────────────────────────────────

router.patch("/orders/:webOrderId/approve", requireAdmin, async (req, res) => {
  try {
    await service.approveOrderEarning(req.params.webOrderId);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

router.patch("/transfers/:payoutId/transferred", requireAdmin, async (req, res) => {
  try {
    await service.markPayoutTransferred(req.params.payoutId);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

export default router;

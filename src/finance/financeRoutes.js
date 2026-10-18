import { Router } from "express";
import requireSeller from "../middleware/requireSeller.js";
import * as ctrl from "./financeController.js";

const router = Router();
router.use(requireSeller);

router.get("/summary",             ctrl.getSummary);
router.get("/range",               ctrl.getRangeSummary);
router.put("/monthly/:monthKey",   ctrl.setMonthlyEntry);

export default router;

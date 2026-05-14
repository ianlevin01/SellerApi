import { Router }      from "express";
import requireSeller   from "../middleware/requireSeller.js";
import { handleGetProgress, handleDismiss } from "./onboardingController.js";

const router = Router();

router.get("/progress", requireSeller, handleGetProgress);
router.post("/dismiss",  requireSeller, handleDismiss);

export default router;

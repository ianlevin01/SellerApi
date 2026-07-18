import { Router }      from "express";
import requireSeller   from "../middleware/requireSeller.js";
import { handleGetProgress, handleDismiss, handleSetTrack } from "./onboardingController.js";

const router = Router();

router.get  ("/progress", requireSeller, handleGetProgress);
router.post ("/dismiss",  requireSeller, handleDismiss);
router.patch("/track",    requireSeller, handleSetTrack);

export default router;

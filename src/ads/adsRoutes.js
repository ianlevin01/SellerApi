import { Router } from "express";
import requireSeller from "../middleware/requireSeller.js";
import * as ctrl from "./adsController.js";

const router = Router();

router.use(requireSeller);

router.get   ("/campaigns",                          ctrl.listCampaigns);
router.post  ("/campaigns",                          ctrl.createCampaign);
router.put   ("/campaigns/:id",                      ctrl.updateCampaign);
router.delete("/campaigns/:id",                      ctrl.deleteCampaign);

router.get   ("/campaigns/:campaignId/creatives",    ctrl.listCreatives);
router.post  ("/campaigns/:campaignId/creatives",    ctrl.createCreative);
router.put   ("/creatives/:id",                      ctrl.updateCreative);
router.delete("/creatives/:id",                      ctrl.deleteCreative);

router.post  ("/generate-copy",                      ctrl.generateCopy);
router.post  ("/generate-field",                     ctrl.generateField);
router.post  ("/generate-image",                     ctrl.generateImage);
router.post  ("/agent",                              ctrl.agentChat);

export default router;

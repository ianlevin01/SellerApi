import { Router } from "express";
import requireSeller from "../middleware/requireSeller.js";
import * as ctrl from "./metaController.js";

const router = Router();

// Público — Meta redirige aquí después del OAuth
router.get("/callback", ctrl.callback);

// Protegidos — requieren seller autenticado
router.use(requireSeller);
router.get   ("/connect",           ctrl.getConnectUrl);
router.get   ("/status",            ctrl.getStatus);
router.get   ("/ad-accounts",       ctrl.getAdAccounts);
router.post  ("/select-account",    ctrl.selectAdAccount);
router.delete("/disconnect",        ctrl.disconnect);
router.get   ("/pixels",            ctrl.getSellerPixels);
router.get   ("/campaigns",         ctrl.getMetaCampaigns);
router.get   ("/insights",          ctrl.getMetaInsights);
router.patch ("/campaigns/:id",     ctrl.updateMetaCampaign);
router.post  ("/ai",               ctrl.metaAi);

export default router;

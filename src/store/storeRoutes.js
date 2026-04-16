// src/modules/store/storeRoutes.js
import { Router }    from "express";
import requireSeller from "../middleware/requireSeller.js";
import * as storeController from "./storeController.js";

const router = Router();

// Privadas (panel del vendedor)
router.get ("/config",                requireSeller, storeController.getConfig);
router.put ("/config",                requireSeller, storeController.updateConfig);
router.get ("/orders",                requireSeller, storeController.getOrders);

// Públicas (tienda visible para compradores)
router.get ("/public/:slug",          storeController.getPublicStore);
router.post("/public/:slug/order",    storeController.createPublicOrder);

export default router;

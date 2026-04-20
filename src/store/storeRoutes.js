// src/modules/store/storeRoutes.js
import { Router }    from "express";
import requireSeller from "../middleware/requireSeller.js";
import * as storeController from "./storeController.js";

const router = Router();

// Privadas (panel del vendedor)
router.get ("/config",                requireSeller, storeController.getConfig);
router.put ("/config",                requireSeller, storeController.updateConfig);
router.get ("/orders",                requireSeller, storeController.getOrders);
router.get ("/discounts",             requireSeller, storeController.getDiscounts);
router.put ("/discounts",             requireSeller, storeController.updateDiscounts);

// Públicas (tienda visible para compradores)
router.get ("/public/:slug",           storeController.getPublicStore);
router.post("/public/:slug/order",     storeController.createPublicOrder);
router.post("/public/:slug/checkout",  storeController.createCheckout);

export default router;

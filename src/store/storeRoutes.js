// src/modules/store/storeRoutes.js
import { Router }    from "express";
import requireSeller from "../middleware/requireSeller.js";
import * as storeController from "./storeController.js";

const router = Router();

// ── Páginas del vendedor ──────────────────────────────────────
router.get ("/categories",                     requireSeller, storeController.getCategories);
router.get ("/pages",                          requireSeller, storeController.getPages);
router.post("/pages",                          requireSeller, storeController.createPage);
router.get ("/pages/:pageId",                  requireSeller, storeController.getPageConfig);
router.put ("/pages/:pageId",                  requireSeller, storeController.updatePageConfig);
router.delete("/pages/:pageId",               requireSeller, storeController.deletePage);
router.get ("/pages/:pageId/discounts",             requireSeller, storeController.getDiscounts);
router.put ("/pages/:pageId/discounts",             requireSeller, storeController.updateDiscounts);
router.get ("/pages/:pageId/products",              requireSeller, storeController.getPageProducts);
router.post("/pages/:pageId/products/add-all",      requireSeller, storeController.addAllPageProducts);
router.post("/pages/:pageId/products/:productId",   requireSeller, storeController.addPageProduct);
router.delete("/pages/:pageId/products/:productId", requireSeller, storeController.removePageProduct);
router.patch("/pages/:pageId/products/:productId/customize", requireSeller, storeController.customizePageProduct);
router.patch("/pages/:pageId/products/:productId/price",    requireSeller, storeController.setProductPrice);

// ── Legado: apunta a la primera página del vendedor ───────────
router.get ("/config",                         requireSeller, storeController.getConfig);
router.get ("/orders",                         requireSeller, storeController.getOrders);

// ── Públicas (tienda visible para compradores) ────────────────
router.get ("/public/:slug",           storeController.getPublicStore);
router.post("/public/:slug/order",     storeController.createPublicOrder);
router.post("/public/:slug/checkout",  storeController.createCheckout);

export default router;

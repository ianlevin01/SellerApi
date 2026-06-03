// src/modules/store/storeRoutes.js
import { Router }    from "express";
import requireSeller from "../middleware/requireSeller.js";
import * as storeController from "./storeController.js";
import * as intCtrl  from "../integrations/integrationsController.js";
import * as revCtrl  from "../reviews/reviewsController.js";
import combosRoutes  from "../combos/combosRoutes.js";

const router = Router();

// ── Páginas del vendedor ──────────────────────────────────────
router.get ("/categories",                     requireSeller, storeController.getCategories);
router.get ("/pages",                          requireSeller, storeController.getPages);
router.post("/pages",                          requireSeller, storeController.createPage);
router.get   ("/pages/:pageId",          requireSeller, storeController.getPageConfig);
router.put   ("/pages/:pageId",          requireSeller, storeController.updatePageConfig);
router.delete("/pages/:pageId",          requireSeller, storeController.deletePage);
router.post  ("/pages/:pageId/ai-build", requireSeller, storeController.aiConfigPage);
router.get ("/pages/:pageId/discounts",             requireSeller, storeController.getDiscounts);
router.put ("/pages/:pageId/discounts",             requireSeller, storeController.updateDiscounts);
router.get ("/pages/:pageId/products",              requireSeller, storeController.getPageProducts);
router.post("/pages/:pageId/products/add-all",      requireSeller, storeController.addAllPageProducts);
router.get ("/pages/:pageId/products/:productId",   requireSeller, storeController.getPageProduct);
router.post("/pages/:pageId/products/:productId",   requireSeller, storeController.addPageProduct);
router.delete("/pages/:pageId/products/:productId", requireSeller, storeController.removePageProduct);
router.patch("/pages/:pageId/products/:productId/customize", requireSeller, storeController.customizePageProduct);
router.patch("/pages/:pageId/products/:productId/price",    requireSeller, storeController.setProductPrice);
router.patch("/pages/:pageId/products/:productId/promo",    requireSeller, storeController.setProductPromo);
router.use("/pages/:pageId/combos", requireSeller, combosRoutes);

// ── Integraciones ─────────────────────────────────────────────
router.get   ("/pages/:pageId/integrations",              requireSeller, intCtrl.list);
router.post  ("/pages/:pageId/integrations/:key/toggle",  requireSeller, intCtrl.toggle);
router.put   ("/pages/:pageId/integrations/:key/config",  requireSeller, intCtrl.updateConfig);

// ── Reseñas ───────────────────────────────────────────────────
router.post  ("/pages/:pageId/products/:productId/generate-reviews", requireSeller, revCtrl.generate);
router.get   ("/pages/:pageId/products/:productId/reviews",          requireSeller, revCtrl.list);
router.patch ("/pages/:pageId/reviews/:reviewId",                    requireSeller, revCtrl.patch);
router.delete("/pages/:pageId/reviews/:reviewId",                    requireSeller, revCtrl.remove);

// ── Legado: apunta a la primera página del vendedor ───────────
router.get ("/config",                         requireSeller, storeController.getConfig);
router.get ("/orders",                         requireSeller, storeController.getOrders);
router.get ("/my-tier",                        requireSeller, storeController.getMyTierInfo);

// ── Públicas (tienda visible para compradores) ────────────────
router.get ("/public/:slug",                       storeController.getPublicStore);
router.post("/public/:slug/order",                 storeController.createPublicOrder);
router.post("/public/:slug/checkout",              storeController.createCheckout);
router.get ("/public/:slug/shipping/rates",        storeController.getShippingRates);
router.get ("/public/:slug/shipping/agencies",     storeController.getShippingAgencies);
router.get ("/public/:slug/transport-companies",   storeController.getTransportCompanies);
router.get ("/public/:slug/products/:productId/reviews", revCtrl.publicList);

export default router;

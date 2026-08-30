import { Router } from "express";
import multer from "multer";
import requireSeller from "../middleware/requireSeller.js";
import * as ctrl from "./mlController.js";
import { handleWebhook } from "./mlWebhookController.js";

const router = Router();
const upload10mb = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Público — ML redirige aquí después del OAuth
router.get("/callback", ctrl.callback);

// Público — notificaciones push de Mercado Libre
router.post("/webhook", handleWebhook);

// Protegidos — requieren seller autenticado
router.use(requireSeller);
router.get   ("/connect",    ctrl.getConnectUrl);
router.get   ("/status",     ctrl.getStatus);
router.delete("/disconnect", ctrl.disconnect);

router.get   ("/wallet",            ctrl.getWallet);
router.post  ("/wallet/card",       ctrl.saveCard);
router.post  ("/wallet/topup",      ctrl.topup);
router.get   ("/wallet/history",    ctrl.getWalletHistory);
router.post  ("/wallet/pay-debt",       ctrl.payDebt);
router.post  ("/wallet/pay-blocked-debt", ctrl.payBlockedDebt);

router.get   ("/listings",                      ctrl.getListings);
router.get   ("/summary",                       ctrl.getSummary);
router.get   ("/stats",                         ctrl.getStats);
router.post  ("/stats/goal",                    ctrl.setStatsGoal);
router.get   ("/shipping-address-status",       ctrl.getShippingAddressStatus);
router.post  ("/shipping-address-ack",          ctrl.acknowledgeShippingAddress);
router.get   ("/categories/suggest",            ctrl.suggestCategory);
router.get   ("/categories/:id/attributes",     ctrl.getCategoryAttributes);
router.post  ("/pictures/upload", upload10mb.single("image"), ctrl.uploadPicture);
router.post  ("/pictures/generate",             ctrl.generatePicture);
router.get   ("/products/search",                 ctrl.searchProducts);
router.get   ("/products/:productId/price-floor", ctrl.getPriceFloor);
router.post  ("/suggest/title",                 ctrl.suggestTitle);
router.post  ("/suggest/description",           ctrl.suggestDescription);
router.post  ("/suggest/attributes",            ctrl.suggestAttributes);
router.get   ("/listing-fees",                  ctrl.getListingFees);
router.get   ("/listings/:mlItemId/stats",       ctrl.getListingStats);
router.get   ("/listings/:mlItemId/picture-status", ctrl.getPictureStatus);
router.post  ("/products/:productId/publish",   ctrl.publishProduct);
router.patch ("/listings/:mlItemId",            ctrl.updateListingStatus);

router.post  ("/combos",                        ctrl.createCombo);
router.get   ("/combos/:comboId",               ctrl.getComboDetail);
router.patch ("/combos/:comboId",               ctrl.updateComboQuantities);
router.post  ("/combos/:comboId/publish",       ctrl.publishCombo);

export default router;

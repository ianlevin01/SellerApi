// src/modules/products/productsRoutes.js
import { Router }    from "express";
import requireSeller from "../middleware/requireSeller.js";
import * as productsController from "./productsController.js";

const router = Router();

router.use(requireSeller);

// Rutas fijas primero — deben ir ANTES de /:productId para que Express no las interprete como un id
router.get   ("/",                                    productsController.getProducts);
router.get   ("/top-selling",                         productsController.getTopSelling);
router.post  ("/add-all",                             productsController.addAllProducts);
router.post  ("/ai/generate-description",             productsController.generateDescription);

// Seller checkout
router.post  ("/request-product",                     productsController.requestProduct);
router.post  ("/reserve-stock",                       productsController.reserveStock);
router.get   ("/my-reserves",                         productsController.getMyReserves);
router.get   ("/shipping-quote",                      productsController.getShippingQuote);
router.get   ("/shipping-agencies",                   productsController.getShippingAgencies);

router.get   ("/:productId",                          productsController.getProduct);
router.patch ("/:productId/customize",                productsController.customizeProduct);
router.post  ("/:productId/ai/verify-name",           productsController.verifyProductName);
router.post  ("/:productId/ai/verify-image",          productsController.verifyProductImage);
router.post  ("/:productId",                          productsController.addProduct);
router.delete("/:productId",                          productsController.removeProduct);

export default router;

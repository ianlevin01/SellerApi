// src/modules/products/productsRoutes.js
import { Router }    from "express";
import requireSeller from "../middleware/requireSeller.js";
import * as productsController from "./productsController.js";

const router = Router();

router.use(requireSeller);

// Rutas fijas primero — deben ir ANTES de /:productId para que Express no las interprete como un id
router.get   ("/",                                    productsController.getProducts);
router.post  ("/add-all",                             productsController.addAllProducts);
router.post  ("/ai/generate-description",             productsController.generateDescription);

router.get   ("/:productId",                          productsController.getProduct);
router.patch ("/:productId/customize",                productsController.customizeProduct);
router.post  ("/:productId/ai/verify-name",           productsController.verifyProductName);
router.post  ("/:productId/ai/verify-image",          productsController.verifyProductImage);
router.post  ("/:productId",                          productsController.addProduct);
router.delete("/:productId",                          productsController.removeProduct);

export default router;

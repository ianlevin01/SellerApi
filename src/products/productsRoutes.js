// src/modules/products/productsRoutes.js
import { Router }    from "express";
import requireSeller from "../middleware/requireSeller.js";
import * as productsController from "./productsController.js";

const router = Router();

router.use(requireSeller);

// add-all debe ir ANTES de /:productId para que Express no lo interprete como un id
router.get   ("/",                      productsController.getProducts);
router.post  ("/add-all",               productsController.addAllProducts);
router.patch ("/:productId/customize",  productsController.customizeProduct);
router.post  ("/:productId",            productsController.addProduct);
router.delete("/:productId",            productsController.removeProduct);

export default router;

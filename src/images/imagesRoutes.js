// src/modules/images/imagesRoutes.js
import { Router }    from "express";
import multer        from "multer";
import requireSeller from "../middleware/requireSeller.js";
import * as imagesController from "./imagesController.js";

const router = Router();

const upload10mb = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const upload5mb  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5  * 1024 * 1024 } });
const upload2mb  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2  * 1024 * 1024 } });

router.use(requireSeller);

// Store assets: logo, hero, banners, etc. Deben ir antes de /:productId
router.post  ("/logo",            upload2mb.single("image"), imagesController.uploadLogo);
router.post  ("/asset/:assetType", upload2mb.single("image"), imagesController.uploadStoreAsset);

router.post  ("/desc/:productId", upload5mb.single("image"), imagesController.uploadDescriptionMedia);
router.get   ("/:productId",      imagesController.getImages);
router.post  ("/:productId",      upload10mb.single("image"), imagesController.uploadImage);
router.delete("/:productId",      imagesController.deleteImage);

export default router;

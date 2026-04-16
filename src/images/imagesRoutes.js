// src/modules/images/imagesRoutes.js
import { Router }    from "express";
import multer        from "multer";
import requireSeller from "../middleware/requireSeller.js";
import * as imagesController from "./imagesController.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 8 * 1024 * 1024 }, // 8MB
});

router.use(requireSeller);

router.get   ("/:productId", imagesController.getImages);
router.post  ("/:productId", upload.single("image"), imagesController.uploadImage);
router.delete("/:productId", imagesController.deleteImage);

export default router;

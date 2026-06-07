import { Router } from "express";
import multer      from "multer";
import * as combosController from "./combosController.js";

const router = Router({ mergeParams: true });

const upload10mb = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.get   ("/",                            combosController.getCombos);
router.get   ("/:comboId",                    combosController.getCombo);
router.post  ("/",                            combosController.createCombo);
router.patch ("/:comboId",                    combosController.updateCombo);
router.delete("/:comboId",                    combosController.deleteCombo);
router.get   ("/:comboId/images",             combosController.getComboImages);
router.post  ("/:comboId/images",             upload10mb.single("image"), combosController.uploadComboImage);
router.delete("/:comboId/images",             combosController.deleteComboImage);

export default router;

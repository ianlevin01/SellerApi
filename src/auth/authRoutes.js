// src/modules/auth/authRoutes.js
import { Router }    from "express";
import multer        from "multer";
import requireSeller from "../middleware/requireSeller.js";
import * as authController from "./authController.js";

const router = Router();
const uploadAvatar = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } }); 

router.post("/register",           authController.register);
router.get ("/verify",             authController.verifyEmail);
router.post("/login",              authController.login);
router.post("/google",             authController.googleLogin);
router.get ("/me",                 requireSeller, authController.getMe);
router.get ("/profile",            requireSeller, authController.getProfile);
router.put ("/profile",            requireSeller, authController.updateProfile);
router.post("/avatar",             requireSeller, uploadAvatar.single("image"), authController.uploadAvatar);
router.post("/phone/request-otp",  requireSeller, authController.requestOtp);
router.post("/phone/verify-otp",   requireSeller, authController.verifyOtp);

export default router;

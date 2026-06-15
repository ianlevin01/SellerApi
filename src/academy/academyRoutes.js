import { Router } from "express";
import multer        from "multer";
import requireSeller from "../middleware/requireSeller.js";
import requireAdminJWT from "../middleware/requireAdminJWT.js";
import * as ctrl from "./academyController.js";

const router = Router();
const upload5mb = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ── Rutas del seller (requieren JWT de Ventaz) ────────────────
router.get   ("/courses",                    requireSeller, ctrl.getCourses);
router.get   ("/courses/:courseId",          requireSeller, ctrl.getCourse);
router.post  ("/progress/:sectionId",        requireSeller, ctrl.markComplete);
router.delete("/progress/:sectionId",        requireSeller, ctrl.markIncomplete);

// ── Rutas admin ───────────────────────────────────────────────
router.get   ("/admin/metrics",              requireAdminJWT, ctrl.adminGetAllMetrics);
router.get   ("/admin/courses/:courseId/users", requireAdminJWT, ctrl.adminGetCourseUsers);
router.post  ("/admin/thumbnail",            requireAdminJWT, upload5mb.single("image"), ctrl.adminUploadThumbnail);
router.get   ("/admin/courses",              requireAdminJWT, ctrl.adminGetCourses);
router.get   ("/admin/courses/:courseId",    requireAdminJWT, ctrl.adminGetCourse);
router.post  ("/admin/courses",              requireAdminJWT, ctrl.adminCreateCourse);
router.put   ("/admin/courses/:courseId",    requireAdminJWT, ctrl.adminUpdateCourse);
router.delete("/admin/courses/:courseId",    requireAdminJWT, ctrl.adminDeleteCourse);
router.post  ("/admin/courses/:courseId/sections", requireAdminJWT, ctrl.adminCreateSection);
router.put   ("/admin/sections/:sectionId",  requireAdminJWT, ctrl.adminUpdateSection);
router.delete("/admin/sections/:sectionId",  requireAdminJWT, ctrl.adminDeleteSection);

export default router;

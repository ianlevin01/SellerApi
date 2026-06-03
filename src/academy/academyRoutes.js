import { Router } from "express";
import requireSeller from "../middleware/requireSeller.js";
import requireAdminJWT from "../middleware/requireAdminJWT.js";
import * as ctrl from "./academyController.js";

const router = Router();

// ── Rutas del seller (requieren JWT de Ventaz) ────────────────
router.get   ("/courses",                    requireSeller, ctrl.getCourses);
router.get   ("/courses/:courseId",          requireSeller, ctrl.getCourse);
router.post  ("/progress/:sectionId",        requireSeller, ctrl.markComplete);
router.delete("/progress/:sectionId",        requireSeller, ctrl.markIncomplete);

// ── Rutas admin ───────────────────────────────────────────────
router.get   ("/admin/courses",              requireAdminJWT, ctrl.adminGetCourses);
router.get   ("/admin/courses/:courseId",    requireAdminJWT, ctrl.adminGetCourse);
router.post  ("/admin/courses",              requireAdminJWT, ctrl.adminCreateCourse);
router.put   ("/admin/courses/:courseId",    requireAdminJWT, ctrl.adminUpdateCourse);
router.delete("/admin/courses/:courseId",    requireAdminJWT, ctrl.adminDeleteCourse);
router.post  ("/admin/courses/:courseId/sections", requireAdminJWT, ctrl.adminCreateSection);
router.put   ("/admin/sections/:sectionId",  requireAdminJWT, ctrl.adminUpdateSection);
router.delete("/admin/sections/:sectionId",  requireAdminJWT, ctrl.adminDeleteSection);

export default router;

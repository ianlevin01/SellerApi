import * as repo from "./academyRepository.js";
import { getSellerPlan } from "../utils/sellerPlan.js";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import s3, { BUCKET, signKey } from "../utils/s3Client.js";

function handleError(res, err) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  console.error(err);
  return res.status(500).json({ message: "Error interno" });
}

export async function getCourses(req, res) {
  try {
    const { plan_id } = await getSellerPlan(req.seller.id);
    return res.json(await repo.getCourses(req.seller.id, plan_id));
  } catch (err) { handleError(res, err); }
}

export async function getCourse(req, res) {
  try {
    const { plan_id } = await getSellerPlan(req.seller.id);
    const course = await repo.getCourseById(req.params.courseId, req.seller.id, plan_id);
    if (!course) return res.status(404).json({ message: "Curso no encontrado" });
    if (!course.locked) repo.recordView(req.seller.id, req.params.courseId).catch(() => {});
    return res.json(course);
  } catch (err) { handleError(res, err); }
}

export async function markComplete(req, res) {
  try {
    await repo.markComplete(req.seller.id, req.params.sectionId);
    return res.json({ message: "Sección completada" });
  } catch (err) { handleError(res, err); }
}

export async function markIncomplete(req, res) {
  try {
    await repo.markIncomplete(req.seller.id, req.params.sectionId);
    return res.json({ message: "Sección desmarcada" });
  } catch (err) { handleError(res, err); }
}

// ── Admin ─────────────────────────────────────────────────────

export async function adminUploadThumbnail(req, res) {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ message: "No se recibió ningún archivo" });

    const ext = (file.mimetype.split("/")[1] || "jpg").replace("jpeg", "jpg");
    const key = `academy/thumbnails/${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;

    await s3.send(new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         key,
      Body:        file.buffer,
      ContentType: file.mimetype,
    }));

    const url = await signKey(key);
    return res.json({ key, url });
  } catch (err) { handleError(res, err); }
}

export async function adminGetCourses(req, res) {
  try { return res.json(await repo.adminGetCourses()); }
  catch (err) { handleError(res, err); }
}

export async function adminGetCourse(req, res) {
  try {
    const course = await repo.adminGetCourse(req.params.courseId);
    if (!course) return res.status(404).json({ message: "Curso no encontrado" });
    return res.json(course);
  } catch (err) { handleError(res, err); }
}

export async function adminCreateCourse(req, res) {
  try {
    if (!req.body.title) return res.status(400).json({ message: "El título es requerido" });
    return res.status(201).json(await repo.adminCreateCourse(req.body));
  } catch (err) { handleError(res, err); }
}

export async function adminUpdateCourse(req, res) {
  try {
    const course = await repo.adminUpdateCourse(req.params.courseId, req.body);
    if (!course) return res.status(404).json({ message: "Curso no encontrado" });
    return res.json(course);
  } catch (err) { handleError(res, err); }
}

export async function adminDeleteCourse(req, res) {
  try {
    await repo.adminDeleteCourse(req.params.courseId);
    return res.status(204).end();
  } catch (err) { handleError(res, err); }
}

export async function adminCreateSection(req, res) {
  try {
    if (!req.body.title) return res.status(400).json({ message: "El título de la sección es requerido" });
    return res.status(201).json(await repo.adminCreateSection(req.params.courseId, req.body));
  } catch (err) { handleError(res, err); }
}

export async function adminUpdateSection(req, res) {
  try {
    const section = await repo.adminUpdateSection(req.params.sectionId, req.body);
    if (!section) return res.status(404).json({ message: "Sección no encontrada" });
    return res.json(section);
  } catch (err) { handleError(res, err); }
}

export async function adminDeleteSection(req, res) {
  try {
    await repo.adminDeleteSection(req.params.sectionId);
    return res.status(204).end();
  } catch (err) { handleError(res, err); }
}

export async function adminGetAllMetrics(req, res) {
  try { return res.json(await repo.adminGetAllMetrics()); }
  catch (err) { handleError(res, err); }
}

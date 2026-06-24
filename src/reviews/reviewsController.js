import pool           from "../database/db.js";
import * as repo     from "./reviewsRepository.js";
import * as service  from "./reviewsService.js";

function err(res, e) {
  if (e.status) return res.status(e.status).json({ message: e.message });
  console.error(e);
  return res.status(500).json({ message: "Error interno" });
}

async function assertPageAccess(sellerId, pageId) {
  const { rows } = await pool.query(
    "SELECT id FROM seller_pages WHERE id = $1 AND seller_id = $2",
    [pageId, sellerId]
  );
  if (!rows.length) throw { status: 403, message: "Sin acceso" };
}

export async function generate(req, res) {
  try {
    await assertPageAccess(req.seller.id, req.params.pageId);
    const reviews = await service.generateReviews(
      req.params.pageId, req.params.productId, req.seller.id
    );
    return res.status(201).json(reviews);
  } catch (e) { err(res, e); }
}

export async function list(req, res) {
  try {
    await assertPageAccess(req.seller.id, req.params.pageId);
    return res.json(await repo.listByProduct(req.params.pageId, req.params.productId));
  } catch (e) { err(res, e); }
}

export async function patch(req, res) {
  try {
    await assertPageAccess(req.seller.id, req.params.pageId);
    const review = await repo.patch(req.params.reviewId, req.params.pageId, req.body);
    if (!review) return res.status(404).json({ message: "Reseña no encontrada" });
    return res.json(review);
  } catch (e) { err(res, e); }
}

export async function remove(req, res) {
  try {
    await assertPageAccess(req.seller.id, req.params.pageId);
    await repo.remove(req.params.reviewId, req.params.pageId);
    return res.status(204).end();
  } catch (e) { err(res, e); }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function publicList(req, res) {
  try {
    if (!UUID_RE.test(req.params.productId)) return res.json([]);
    const { rows } = await pool.query(
      "SELECT id FROM seller_pages WHERE slug = $1 AND active = true",
      [req.params.slug]
    );
    if (!rows.length) return res.status(404).json({ message: "Tienda no encontrada" });
    return res.json(await repo.publicList(req.params.productId, rows[0].id));
  } catch (e) { err(res, e); }
}

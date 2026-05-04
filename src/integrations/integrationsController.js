import pool from "../database/db.js";
import * as repo from "./integrationsRepository.js";

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
  if (!rows.length) throw { status: 403, message: "Sin acceso a esta tienda" };
}

export async function list(req, res) {
  try {
    await assertPageAccess(req.seller.id, req.params.pageId);
    return res.json(await repo.listWithStatus(req.params.pageId));
  } catch (e) { err(res, e); }
}

export async function toggle(req, res) {
  try {
    await assertPageAccess(req.seller.id, req.params.pageId);
    const { active } = req.body;
    if (typeof active !== "boolean")
      return res.status(400).json({ message: "active (boolean) requerido" });
    const row = await repo.toggle(req.params.pageId, req.params.key, active);
    if (!row) return res.status(404).json({ message: "Integración no encontrada" });
    return res.json({ ok: true, active });
  } catch (e) { err(res, e); }
}

export async function updateConfig(req, res) {
  try {
    await assertPageAccess(req.seller.id, req.params.pageId);
    const row = await repo.updateConfig(req.params.pageId, req.params.key, req.body.config || {});
    if (!row) return res.status(404).json({ message: "Integración no activada" });
    return res.json({ ok: true });
  } catch (e) { err(res, e); }
}

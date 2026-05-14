import { Router } from "express";
import requireAdminJWT from "../middleware/requireAdminJWT.js";
import * as svc        from "./consumerChatService.js";

function handleError(res, err) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  console.error(err);
  return res.status(500).json({ message: "Error interno" });
}

// ── Public routes (no auth) — consumer access via token ─────────────────────
export const consumerPublicRouter = Router();

consumerPublicRouter.post("/:slug/conversations", async (req, res) => {
  try {
    const { consumer_email, consumer_name, consumer_phone, order_items, grand_total, shipping_info } = req.body;
    if (!consumer_email || !consumer_name)
      return res.status(400).json({ message: "consumer_email y consumer_name requeridos" });
    const result = await svc.createConversation(req.params.slug, {
      consumer_email, consumer_name, consumer_phone, order_items, grand_total, shipping_info,
    });
    return res.status(201).json(result);
  } catch (err) { handleError(res, err); }
});

consumerPublicRouter.get("/conversations/:id/messages", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ message: "token requerido" });
    return res.json(await svc.getMessages(req.params.id, token));
  } catch (err) { handleError(res, err); }
});

consumerPublicRouter.post("/conversations/:id/messages", async (req, res) => {
  try {
    const { token } = req.query;
    const { body: body_text } = req.body;
    if (!token) return res.status(400).json({ message: "token requerido" });
    if (!body_text?.trim()) return res.status(400).json({ message: "Mensaje vacío" });
    const msg = await svc.postConsumerMessage(req.params.id, token, body_text.trim());
    return res.status(201).json(msg);
  } catch (err) { handleError(res, err); }
});

// ── Admin routes (requireAdminJWT) ──────────────────────────────────────────
export const consumerAdminRouter = Router();
consumerAdminRouter.use(requireAdminJWT);

consumerAdminRouter.get("/conversations", async (req, res) => {
  try { return res.json(await svc.adminGetAll()); }
  catch (err) { handleError(res, err); }
});

consumerAdminRouter.get("/conversations/:id/messages", async (req, res) => {
  try { return res.json(await svc.adminGetMessages(req.params.id)); }
  catch (err) { handleError(res, err); }
});

consumerAdminRouter.post("/conversations/:id/reply", async (req, res) => {
  try {
    const { body: body_text } = req.body;
    if (!body_text?.trim()) return res.status(400).json({ message: "Mensaje vacío" });
    const msg = await svc.adminReply(req.params.id, body_text.trim());
    return res.status(201).json(msg);
  } catch (err) { handleError(res, err); }
});

import { Router } from "express";
import requireAdminJWT  from "../middleware/requireAdminJWT.js";
import requireSeller    from "../middleware/requireSeller.js";
import * as repo        from "./adminChatRepository.js";

// ── Admin-facing routes (/admin/chat/*, /admin/monitor/*) ────
export const adminChatRouter = Router();
adminChatRouter.use(requireAdminJWT);

const h = fn => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (err) { res.status(err.status || 500).json({ message: err.message }); }
};

adminChatRouter.get("/sellers", h(() => repo.getAllAdminConversations()));

adminChatRouter.get("/sellers/:sellerId/messages", h(async req => {
  const conv = await repo.getOrCreateConversation(req.params.sellerId);
  await repo.markAdminMessagesRead(conv.id, 'admin');
  return { conversationId: conv.id, messages: await repo.getAdminMessages(conv.id) };
}));

adminChatRouter.post("/sellers/:sellerId/messages", h(async req => {
  if (!req.body.body?.trim()) throw { status: 400, message: "Mensaje vacío" };
  const conv = await repo.getOrCreateConversation(req.params.sellerId);
  return repo.sendAdminMessage(conv.id, 'admin', req.body.body.trim());
}));

// Monitor
export const adminMonitorRouter = Router();
adminMonitorRouter.use(requireAdminJWT);

adminMonitorRouter.get("/conversations",       h(() => repo.getMonitorConversations()));
adminMonitorRouter.get("/conversations/:id/messages", h(req => repo.getMonitorMessages(req.params.id)));

// ── Seller-facing routes (/seller/chat/admin) ────────────────
export const sellerAdminChatRouter = Router();
sellerAdminChatRouter.use(requireSeller);

sellerAdminChatRouter.get("/messages", h(async req => {
  const result = await repo.getSellerAdminMessages(req.seller.id);
  await repo.markAdminMessagesRead(result.conversationId, 'seller');
  return result;
}));

sellerAdminChatRouter.post("/messages", h(async req => {
  if (!req.body.body?.trim()) throw { status: 400, message: "Mensaje vacío" };
  return repo.sellerSendAdminMessage(req.seller.id, req.body.body.trim());
}));

sellerAdminChatRouter.get("/unread", h(req => repo.getSellerUnreadAdminCount(req.seller.id)));

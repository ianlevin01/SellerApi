import { Router } from "express";
import multer          from "multer";
import requireAdminJWT from "../middleware/requireAdminJWT.js";
import requireSeller   from "../middleware/requireSeller.js";
import * as repo       from "./adminChatRepository.js";
import { notifySellerAdminMessage } from "../email/buyerEmails.js";
import { uploadBuffer } from "../utils/s3Client.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

function chatImageKey(mimetype) {
  const ext = (mimetype || "image/jpeg").split("/")[1] || "jpg";
  return `chat-images/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
}

// ── Admin-facing routes (/admin/chat/*, /admin/monitor/*) ────
export const adminChatRouter = Router();
adminChatRouter.use(requireAdminJWT);

const h = fn => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (err) { res.status(err.status || 500).json({ message: err.message }); }
};

adminChatRouter.get("/sellers", h(() => repo.getAllSellersWithChatInfo()));

adminChatRouter.get("/sellers/:sellerId/messages", h(async req => {
  const conv = await repo.getOrCreateConversation(req.params.sellerId);
  await repo.markAdminMessagesRead(conv.id, 'admin');
  return { conversationId: conv.id, messages: await repo.getAdminMessages(conv.id) };
}));

adminChatRouter.post("/sellers/:sellerId/messages", h(async req => {
  const body      = req.body.body?.trim() || null;
  const imageUrl  = req.body.image_url || null;
  if (!body && !imageUrl) throw { status: 400, message: "Mensaje vacío" };

  const conv    = await repo.getOrCreateConversation(req.params.sellerId);
  const message = await repo.sendAdminMessage(conv.id, 'admin', body, imageUrl);

  if (body) {
    repo.getSellerInfo(req.params.sellerId)
      .then(s => { if (s?.email) notifySellerAdminMessage({ sellerEmail: s.email, sellerName: s.name, messageBody: body }); })
      .catch(() => {});
  }

  return message;
}));

adminChatRouter.post("/upload-image", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Sin archivo" });
    if (!req.file.mimetype.startsWith("image/")) return res.status(400).json({ message: "Solo se aceptan imágenes" });
    const key = chatImageKey(req.file.mimetype);
    await uploadBuffer(key, req.file.buffer, req.file.mimetype);
    res.json({ key });
  } catch (err) {
    console.error("[chat-upload]", err.message);
    res.status(500).json({ message: "Error al subir imagen" });
  }
});

// Monitor
export const adminMonitorRouter = Router();
adminMonitorRouter.use(requireAdminJWT);

adminMonitorRouter.get("/sellers",                           h(() => repo.getSellersForMonitor()));
adminMonitorRouter.get("/sellers/:sellerId/conversations",   h(req => repo.getConversationsBySeller(req.params.sellerId)));
adminMonitorRouter.get("/conversations",                     h(() => repo.getMonitorConversations()));
adminMonitorRouter.get("/conversations/:id/messages",        h(req => repo.getMonitorMessages(req.params.id)));

// ── Seller-facing routes (/seller/chat/admin) ────────────────
export const sellerAdminChatRouter = Router();
sellerAdminChatRouter.use(requireSeller);

sellerAdminChatRouter.get("/messages", h(async req => {
  const result = await repo.getSellerAdminMessages(req.seller.id);
  await repo.markAdminMessagesRead(result.conversationId, 'seller');
  return result;
}));

sellerAdminChatRouter.post("/messages", h(async req => {
  const body     = req.body.body?.trim() || null;
  const imageUrl = req.body.image_url || null;
  if (!body && !imageUrl) throw { status: 400, message: "Mensaje vacío" };
  return repo.sellerSendAdminMessage(req.seller.id, body, imageUrl);
}));

sellerAdminChatRouter.post("/upload-image", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Sin archivo" });
    if (!req.file.mimetype.startsWith("image/")) return res.status(400).json({ message: "Solo se aceptan imágenes" });
    const key = chatImageKey(req.file.mimetype);
    await uploadBuffer(key, req.file.buffer, req.file.mimetype);
    res.json({ key });
  } catch (err) {
    console.error("[chat-upload]", err.message);
    res.status(500).json({ message: "Error al subir imagen" });
  }
});

sellerAdminChatRouter.get("/unread", h(req => repo.getSellerUnreadAdminCount(req.seller.id)));

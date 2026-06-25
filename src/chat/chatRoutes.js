// src/modules/chat/chatRoutes.js
import { Router }    from "express";
import multer        from "multer";
import requireSeller from "../middleware/requireSeller.js";
import * as chatController from "./chatController.js";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import s3, { BUCKET } from "../utils/s3Client.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// ── Rutas públicas (montadas en /store/:slug/chat) ────────────
export const publicRouter = Router({ mergeParams: true });

publicRouter.post  ("/",                                   chatController.startConversation);
publicRouter.get   ("/:conversationId/messages",           chatController.getPublicMessages);
publicRouter.post  ("/:conversationId/messages",           chatController.sendPublicMessage);
publicRouter.post  ("/:conversationId/quote",              chatController.sendQuoteRequest);

// ── Rutas protegidas (montadas en /seller/chat) ───────────────
export const sellerRouter = Router();

sellerRouter.use(requireSeller);
sellerRouter.get ("/conversations",                                         chatController.getConversations);
sellerRouter.get ("/conversations/:conversationId/messages",                chatController.getSellerMessages);
sellerRouter.post("/conversations/:conversationId/messages",                chatController.sendSellerMessage);
sellerRouter.post("/conversations/:conversationId/quote/:messageId/accept", chatController.acceptQuote);

sellerRouter.post("/conversations/:conversationId/upload-image", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Sin archivo" });
    if (!req.file.mimetype.startsWith("image/")) return res.status(400).json({ message: "Solo se aceptan imágenes" });
    const ext = req.file.mimetype.split("/")[1] || "jpg";
    const key = `chat-images/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: req.file.buffer, ContentType: req.file.mimetype }));
    res.json({ key });
  } catch (err) {
    console.error("[chat-upload]", err.message);
    res.status(500).json({ message: "Error al subir imagen" });
  }
});

export default publicRouter;

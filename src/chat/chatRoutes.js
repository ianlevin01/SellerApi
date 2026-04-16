// src/modules/chat/chatRoutes.js
import { Router }    from "express";
import requireSeller from "../middleware/requireSeller.js";
import * as chatController from "./chatController.js";

const router = Router();

// ── Rutas públicas (montadas en /store/:slug/chat) ────────────
export const publicRouter = Router({ mergeParams: true });

publicRouter.post  ("/",                              chatController.startConversation);
publicRouter.get   ("/:conversationId/messages",      chatController.getPublicMessages);
publicRouter.post  ("/:conversationId/messages",      chatController.sendPublicMessage);

// ── Rutas protegidas (montadas en /seller/chat) ───────────────
export const sellerRouter = Router();

sellerRouter.use(requireSeller);
sellerRouter.get ("conversations",                    chatController.getConversations);
sellerRouter.get ("conversations/:conversationId/messages",  chatController.getSellerMessages);
sellerRouter.post("conversations/:conversationId/messages",  chatController.sendSellerMessage);

export default router;

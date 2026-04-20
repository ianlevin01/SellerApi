// src/modules/chat/chatController.js
import * as chatService from "./chatService.js";

function handleError(res, err) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  console.error(err);
  return res.status(500).json({ message: "Error interno" });
}

// ── Público ───────────────────────────────────────────────────

export async function startConversation(req, res) {
  try {
    const result = await chatService.startConversation(req.params.slug, req.body);
    return res.status(201).json(result);
  } catch (err) { handleError(res, err); }
}

export async function getPublicMessages(req, res) {
  try {
    const { slug, conversationId } = req.params;
    const token = req.query.token;
    const result = await chatService.getPublicMessages(slug, Number(conversationId), token);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function sendPublicMessage(req, res) {
  try {
    const { slug, conversationId } = req.params;
    const token = req.query.token;
    const result = await chatService.sendPublicMessage(slug, Number(conversationId), token, req.body.body);
    return res.status(201).json(result);
  } catch (err) { handleError(res, err); }
}

export async function sendQuoteRequest(req, res) {
  try {
    const { slug, conversationId } = req.params;
    const token = req.query.token;
    const result = await chatService.sendQuoteRequest(slug, Number(conversationId), token, req.body);
    return res.status(201).json(result);
  } catch (err) { handleError(res, err); }
}

// ── Protegido (vendedor) ──────────────────────────────────────

export async function getConversations(req, res) {
  try {
    const result = await chatService.getConversations(req.seller.id);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function getSellerMessages(req, res) {
  try {
    const result = await chatService.getSellerMessages(req.seller.id, Number(req.params.conversationId));
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function sendSellerMessage(req, res) {
  try {
    const result = await chatService.sendSellerMessage(req.seller.id, Number(req.params.conversationId), req.body.body);
    return res.status(201).json(result);
  } catch (err) { handleError(res, err); }
}

export async function acceptQuote(req, res) {
  try {
    const { conversationId, messageId } = req.params;
    const result = await chatService.acceptQuote(req.seller.id, Number(conversationId), Number(messageId));
    return res.status(201).json(result);
  } catch (err) { handleError(res, err); }
}

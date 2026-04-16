// src/modules/chat/chatService.js
import * as chatRepository from "./chatRepository.js";
import * as storeRepository from "../store/storeRepository.js";

// ── Público (cliente en la tienda) ────────────────────────────

export async function startConversation(slug, { customer_name, customer_email, customer_phone, body }) {
  if (!customer_name?.trim()) throw { status: 400, message: "El nombre es requerido" };
  if (!body?.trim())          throw { status: 400, message: "El mensaje es requerido" };

  const page = await storeRepository.getPageBySlug(slug);
  if (!page) throw { status: 404, message: "Tienda no encontrada" };

  const conversation = await chatRepository.findOrCreateConversation(page.seller_id, {
    customer_name: customer_name.trim(),
    customer_email: customer_email?.trim() || null,
    customer_phone: customer_phone?.trim() || null,
  });

  await chatRepository.insertMessage(conversation.id, "customer", body.trim());

  return { conversation_id: conversation.id, access_token: conversation.access_token };
}

export async function getPublicMessages(slug, conversationId, accessToken) {
  if (!accessToken) throw { status: 401, message: "Token requerido" };

  const conversation = await chatRepository.getConversationByToken(conversationId, accessToken);
  if (!conversation)  throw { status: 403, message: "Acceso denegado" };

  return chatRepository.getMessages(conversationId);
}

export async function sendPublicMessage(slug, conversationId, accessToken, body) {
  if (!body?.trim())  throw { status: 400, message: "El mensaje no puede estar vacío" };
  if (!accessToken)   throw { status: 401, message: "Token requerido" };

  const conversation = await chatRepository.getConversationByToken(conversationId, accessToken);
  if (!conversation)  throw { status: 403, message: "Acceso denegado" };

  return chatRepository.insertMessage(conversationId, "customer", body.trim());
}

// ── Protegido (vendedor en el panel) ─────────────────────────

export async function getConversations(sellerId) {
  return chatRepository.getConversationsForSeller(sellerId);
}

export async function getSellerMessages(sellerId, conversationId) {
  const conversation = await chatRepository.getConversationById(conversationId, sellerId);
  if (!conversation) throw { status: 404, message: "Conversación no encontrada" };

  await chatRepository.markCustomerMessagesRead(conversationId);
  return {
    conversation,
    messages: await chatRepository.getMessages(conversationId),
  };
}

export async function sendSellerMessage(sellerId, conversationId, body) {
  if (!body?.trim()) throw { status: 400, message: "El mensaje no puede estar vacío" };

  const conversation = await chatRepository.getConversationById(conversationId, sellerId);
  if (!conversation) throw { status: 404, message: "Conversación no encontrada" };

  return chatRepository.insertMessage(conversationId, "seller", body.trim());
}

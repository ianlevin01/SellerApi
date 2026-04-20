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
    customer_name:  customer_name.trim(),
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

export async function sendQuoteRequest(slug, conversationId, accessToken, { items, total }) {
  if (!accessToken) throw { status: 401, message: "Token requerido" };

  const conversation = await chatRepository.getConversationByToken(conversationId, accessToken);
  if (!conversation) throw { status: 403, message: "Acceso denegado" };

  if (!items?.length) throw { status: 400, message: "El carrito está vacío" };

  return chatRepository.insertQuoteMessage(conversationId, { items, total });
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

export async function acceptQuote(sellerId, conversationId, messageId) {
  const conversation = await chatRepository.getConversationById(conversationId, sellerId);
  if (!conversation) throw { status: 404, message: "Conversación no encontrada" };

  const message = await chatRepository.getMessageById(messageId);
  if (!message || message.conversation_id !== conversationId)
    throw { status: 404, message: "Mensaje no encontrado" };
  if (message.msg_type !== "quote_request")
    throw { status: 400, message: "El mensaje no es una solicitud de cotización" };

  const { items, total } = message.quote_data;

  const order = await storeRepository.createPublicOrder({
    customer: {
      name:  conversation.customer_name,
      email: conversation.customer_email,
      phone: conversation.customer_phone,
      notes: `Cotización aceptada desde chat (conv. #${conversationId})`,
    },
    total,
    seller_id: sellerId,
  });
  await storeRepository.createOrderItems(order.id, items);

  const msg = await chatRepository.insertQuoteAcceptedMessage(conversationId, order.numero);

  return { order_number: order.numero, message: msg };
}

import crypto from "crypto";
import db     from "../database/db.js";
import * as repo from "./consumerChatRepository.js";
import { transporter } from "../config/mailer.js";

const STORE_DOMAIN = process.env.STORE_PAGE_DOMAIN;
const FROM_EMAIL   = process.env.SMTP_FROM_AWS || "noreply@ventaz.com.ar";

function chatUrl(slug, convId, token) {
  if (!slug || !STORE_DOMAIN) return null;
  return `https://${slug}.${STORE_DOMAIN}/chat/${convId}?token=${token}`;
}

export async function createConversation(slug, body) {
  const { rows } = await db.query(
    `SELECT s.id FROM sellers s JOIN seller_pages sp ON sp.seller_id = s.id WHERE sp.slug = $1 LIMIT 1`,
    [slug]
  );
  const seller_id    = rows[0]?.id || null;
  const access_token = crypto.randomBytes(32).toString("hex");

  // Create a pending web_order so the seller sees it in their panel
  let webOrderNumero = null;
  if (seller_id) {
    try {
      const order = await repo.createConsultationOrder({
        seller_id,
        customer: {
          name:  body.consumer_name,
          email: body.consumer_email,
          phone: body.consumer_phone || null,
          city:  body.customer_city  || body.shipping_info?.city || null,
          notes: body.customer_notes || null,
        },
        items: (body.order_items || []).map(i => ({
          product_id: i.product_id || null,
          name:       i.name,
          quantity:   i.quantity || i.qty || 1,
          unit_price: i.unit_price || i.effectivePrice || 0,
        })),
        total:    body.grand_total   || 0,
        shipping: body.shipping_info || null,
      });
      webOrderNumero = order.numero || order.id;
    } catch (err) {
      console.error("[ConsumerChat] createConsultationOrder error:", err.message);
    }
  }

  const conv = await repo.createConversation({
    seller_id,
    consumer_email: body.consumer_email,
    consumer_name:  body.consumer_name,
    consumer_phone: body.consumer_phone || null,
    access_token,
    subject:       `Consulta de ${body.consumer_name} — $${Math.round(body.grand_total || 0).toLocaleString("es-AR")}`,
    order_items:   body.order_items   || [],
    grand_total:   body.grand_total   || 0,
    shipping_info: body.shipping_info || {},
    store_slug:    slug || null,
  });

  await repo.addMessage(conv.id, "admin",
    `¡Hola ${body.consumer_name}! Recibimos tu consulta. En breve nos ponemos en contacto para coordinar el envío y resolver cualquier duda. 🙌`
  );

  return { id: conv.id, access_token, chat_url: chatUrl(slug, conv.id, access_token) };
}

export async function getMessages(id, token) {
  const conv = await repo.getConversationByToken(id, token);
  if (!conv) throw { status: 404, message: "Conversación no encontrada" };
  await repo.markAdminMessagesRead(id);
  return { conversation: conv, messages: await repo.getMessages(id) };
}

export async function postConsumerMessage(id, token, body_text) {
  const conv = await repo.getConversationByToken(id, token);
  if (!conv) throw { status: 404, message: "Conversación no encontrada" };
  return repo.addMessage(id, "consumer", body_text);
}

export async function adminGetAll() {
  return repo.getAllConversations();
}

export async function adminGetMessages(id) {
  const conv = await repo.getConversationById(id);
  if (!conv) throw { status: 404, message: "Conversación no encontrada" };
  await repo.markConsumerMessagesRead(id);
  return { conversation: conv, messages: await repo.getMessages(id) };
}

export async function adminReply(id, body_text) {
  const conv = await repo.getConversationById(id);
  if (!conv) throw { status: 404, message: "Conversación no encontrada" };

  const msg = await repo.addMessage(id, "admin", body_text);

  let link = null;
  if (conv.seller_id) {
    // Usar el slug guardado en la conversación; si es NULL (conversaciones antiguas)
    // hacer fallback a la primera página activa del vendedor.
    const slug = conv.store_slug || await repo.getSlugBySellerId(conv.seller_id);
    link = chatUrl(slug, conv.id, conv.access_token);
  }

  try {
    await transporter.sendMail({
      from:    FROM_EMAIL,
      to:      conv.consumer_email,
      subject: `Respuesta a tu consulta — Ventaz`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#333">
          <h2 style="color:#333">Tienes una nueva respuesta</h2>
          <p>Hola <strong>${conv.consumer_name}</strong>,</p>
          <p>El equipo Ventaz te respondió:</p>
          <blockquote style="background:#f5f5f5;border-left:4px solid #4db81a;padding:12px 16px;margin:16px 0;border-radius:4px;color:#222">
            ${body_text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/\n/g,"<br>")}
          </blockquote>
          ${link ? `<p><a href="${link}" style="background:#4db81a;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600">Ver conversación completa</a></p>` : ""}
          <p style="color:#999;font-size:12px;margin-top:24px">Ventaz — No respondas a este correo.</p>
        </div>
      `,
    });
  } catch (err) {
    console.error("[ConsumerChat] sendMail error:", err.message);
  }

  return msg;
}

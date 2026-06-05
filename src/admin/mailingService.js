// src/admin/mailingService.js
import OpenAI from "openai";
import { transporter } from "../config/mailer.js";
import pool from "../database/db.js";

let openaiClient = null;
function getClient() {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) throw { status: 503, message: "OPENAI_API_KEY no configurada" };
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

// Saca los base64 del HTML antes de mandarlo a la IA (pueden ser cientos de KB)
// y los restaura en el HTML que devuelve la IA.
function stripBase64(html) {
  const blobs = [];
  const stripped = html.replace(/src="(data:[^"]{20,})"/g, (_match, src) => {
    const idx = blobs.length;
    blobs.push(src);
    return `src="__BLOB_${idx}__"`;
  });
  return { stripped, blobs };
}

function restoreBase64(html, blobs) {
  if (!blobs.length) return html;
  return html.replace(/src="__BLOB_(\d+)__"/g, (_match, idx) => {
    return `src="${blobs[parseInt(idx)] ?? ""}"`;
  });
}

const SYSTEM_PROMPT = (html) => `
Sos un diseñador experto en emails HTML para la plataforma Ventaz (Argentina).
Tu única tarea es modificar el HTML del email que te dan según las instrucciones del usuario.

REGLAS CRÍTICAS:
- Respondé SIEMPRE con un JSON válido con exactamente dos campos:
  "html": string con el HTML completo del email (bien formateado)
  "message": string corto en español argentino explicando qué cambiaste (máx 2 oraciones)
- El HTML debe ser compatible con clientes de email (Gmail, Outlook): usá tablas, estilos inline
- Mantené siempre el diseño de Ventaz: fondo oscuro #07110d, verde #4bff9c, tipografía Arial
- No cambies la estructura base a menos que explícitamente te lo pidan
- Si te piden un link y no te dan la URL, usá href="#" como placeholder
- Las imágenes con src="__BLOB_N__" son placeholders — NO las elimines, dejálas exactamente igual
- El campo "html" debe ser el HTML completo del email (desde <!DOCTYPE html> hasta </html>)
- Nunca incluyas explicaciones fuera del JSON, solo el JSON

HTML ACTUAL DEL EMAIL:
\`\`\`html
${html}
\`\`\`
`.trim();

export async function generateMailHtml(messages = [], currentHtml) {
  if (!currentHtml) throw { status: 400, message: "currentHtml es requerido" };
  if (!messages?.length) throw { status: 400, message: "messages es requerido" };

  const client = getClient();

  // Sacar base64 antes de mandar a la IA
  const { stripped, blobs } = stripBase64(currentHtml);

  // Solo mandar los últimos 10 mensajes para no inflar el contexto
  const trimmedMessages = messages.slice(-10).map(m => ({
    role: m.role,
    content: m.content,
  }));

  const completion = await client.chat.completions.create({
    model:           "gpt-4o-mini",
    max_tokens:      4096,
    temperature:     0.3,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT(stripped) },
      ...trimmedMessages,
    ],
  });

  let result;
  try {
    result = JSON.parse(completion.choices[0].message.content);
  } catch {
    throw { status: 500, message: "La IA devolvió una respuesta inválida" };
  }

  if (!result.html || !result.message) {
    throw { status: 500, message: "Respuesta incompleta de la IA" };
  }

  // Restaurar los base64 en el HTML que devolvió la IA
  return { html: restoreBase64(result.html, blobs), message: result.message };
}

const FROM = () => `Ventaz <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`;

const TEXT_FALLBACK = "Este mensaje fue enviado desde Ventaz. Si estás viendo este texto, tu cliente de mail no soporta HTML.";

export async function sendTestMail({ html, subject }) {
  if (!html) throw { status: 400, message: "html es requerido" };
  await transporter.sendMail({
    from:    FROM(),
    to:      "ventaz.oficial@gmail.com",
    subject: subject || "Mail de prueba — Ventaz",
    html,
    text:    TEXT_FALLBACK,
  });
  return { ok: true, sent: 1 };
}

export async function sendMassMail({ html, subject }) {
  if (!html) throw { status: 400, message: "html es requerido" };

  const { rows } = await pool.query(
    `SELECT email FROM sellers WHERE active = true ORDER BY created_at`
  );

  let sent = 0;
  let failed = 0;

  for (const { email } of rows) {
    try {
      await transporter.sendMail({
        from:    FROM(),
        to:      email,
        subject: subject || "Novedades de Ventaz",
        html,
        text:    TEXT_FALLBACK,
      });
      sent++;
      await new Promise(r => setTimeout(r, 120));
    } catch (e) {
      console.warn(`[mailing] falló envío a ${email}:`, e.message);
      failed++;
    }
  }

  return { ok: true, sent, failed, total: rows.length };
}

// src/admin/mailingService.js
import OpenAI from "openai";

let openaiClient = null;
function getClient() {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) throw { status: 503, message: "OPENAI_API_KEY no configurada" };
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

const SYSTEM_PROMPT = (currentHtml) => `
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
- Si te piden cambiar solo el contenido (texto, título, etc.) no toques los estilos ni la estructura
- El campo "html" debe ser el HTML completo del email (desde <!DOCTYPE html> hasta </html>)
- Nunca incluyas explicaciones fuera del JSON, solo el JSON

HTML ACTUAL DEL EMAIL:
\`\`\`html
${currentHtml}
\`\`\`
`.trim();

export async function generateMailHtml(messages = [], currentHtml) {
  if (!currentHtml) throw { status: 400, message: "currentHtml es requerido" };
  if (!messages?.length) throw { status: 400, message: "messages es requerido" };

  const client = getClient();

  const completion = await client.chat.completions.create({
    model:           "gpt-4o",
    max_tokens:      4096,
    temperature:     0.3,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT(currentHtml) },
      ...messages.map(m => ({ role: m.role, content: m.content })),
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

  return { html: result.html, message: result.message };
}

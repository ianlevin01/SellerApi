import OpenAI from "openai";
import pool   from "../database/db.js";

let _client = null;
function getClient() {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY no configurada");
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

export async function getOriginalProductName(productId) {
  const { rows } = await pool.query("SELECT name FROM products WHERE id = $1", [productId]);
  return rows[0]?.name || null;
}

// ── Verificar que el nombre personalizado sea coherente con el producto ────────

export async function verifyProductName(originalName, customName) {
  if (!customName || !customName.trim()) return { valid: true };

  const ai  = getClient();
  const res = await ai.chat.completions.create({
    model:           "gpt-4o-mini",
    max_tokens:      120,
    temperature:     0,
    response_format: { type: "json_object" },
    messages: [
      {
        role:    "system",
        content: `Sos un moderador de contenido para una plataforma de e-commerce argentina.
Tu única tarea es detectar si el nombre propuesto pertenece a una categoría de producto COMPLETAMENTE diferente al original.

Regla principal: si ambos son el mismo tipo de objeto o categoría general, siempre es válido.
Ejemplos VÁLIDOS (aprobá sin dudar):
- "reloj deportivo" → "reloj digital" ✅ (ambos son relojes)
- "zapatillas running" → "calzado deportivo" ✅ (misma categoría)
- "silla de oficina" → "silla ergonómica con ruedas" ✅ (misma categoría)
- "laptop 15 pulgadas" → "notebook gamer" ✅ (ambas son computadoras portátiles)
- "mochila escolar" → "bolso para viaje" ✅ (ambos son bolsos/mochilas)
- Cualquier descripción, especificación o variante del mismo tipo de producto ✅

Rechazá SOLO si es categoría completamente diferente sin relación posible:
- "reloj" → "licuadora" ❌
- "silla" → "celular" ❌

Respondé SOLO con JSON: { "valid": true } o { "valid": false, "reason": "razón muy breve" }`,
      },
      {
        role:    "user",
        content: `Original: "${originalName}"\nPropuesto: "${customName}"`,
      },
    ],
  });

  try {
    return JSON.parse(res.choices[0].message.content);
  } catch {
    return { valid: true };
  }
}

// ── Verificar que la imagen sea coherente con el producto (visión) ─────────────

export async function verifyProductImage(originalName, imageUrl) {
  const ai  = getClient();
  const res = await ai.chat.completions.create({
    model:           "gpt-4o-mini",
    max_tokens:      120,
    temperature:     0,
    response_format: { type: "json_object" },
    messages: [
      {
        role:    "system",
        content: `Sos un moderador de contenido para una plataforma de e-commerce argentina.
Tu única tarea es detectar si la imagen muestra un producto de una categoría COMPLETAMENTE diferente al original.

Aprobá siempre si la imagen muestra:
- El mismo tipo de producto (aunque sea diferente modelo, color, marca o variante)
- Accesorios o partes relacionadas con ese producto
- El producto en uso o en contexto

Rechazá SOLO si la imagen muestra algo que no tiene ninguna relación con la categoría del producto original.

Respondé SOLO con JSON: { "valid": true } o { "valid": false, "reason": "razón muy breve" }`,
      },
      {
        role:    "user",
        content: [
          {
            type: "text",
            text: `Producto original: "${originalName}". ¿La imagen corresponde a este producto o algo relacionado?`,
          },
          {
            type:      "image_url",
            image_url: { url: imageUrl, detail: "low" },
          },
        ],
      },
    ],
  });

  try {
    return JSON.parse(res.choices[0].message.content);
  } catch {
    return { valid: true };
  }
}

// ── Generar descripción de e-commerce completa ────────────────────────────────

export async function generateProductDescription(productName, brief) {
  const ai  = getClient();
  const res = await ai.chat.completions.create({
    model:       "gpt-4o-mini",
    max_tokens:  900,
    temperature: 0.7,
    messages: [
      {
        role:    "system",
        content: `Sos un experto redactor de e-commerce para el mercado argentino.
Tu tarea es expandir y embellecer lo que te describe el vendedor, NO inventar características propias.
REGLA PRINCIPAL: usá la descripción del vendedor como única fuente. No agregues medidas, materiales ni especificaciones que no haya mencionado.
Podés mejorar el estilo, estructurar mejor el texto y hacerlo más atractivo y comercial, pero siempre basándote solo en lo que el vendedor describió.
Formato HTML: <h2> o <h3> para secciones, <ul><li> para listas, <p> para párrafos.
Estilo: informal-profesional argentino.
Devolvé SOLO el HTML, sin explicaciones, sin markdown, sin bloque de código.`,
      },
      {
        role:    "user",
        content: `Nombre del producto: "${productName}"\n\nDescripción del vendedor (fuente principal — expandila y mejorala):\n"${brief}"\n\nGenerá la descripción de e-commerce.`,
      },
    ],
  });

  return res.choices[0].message.content.trim();
}

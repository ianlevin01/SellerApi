// Sugerencias con IA para el wizard de publicar en Mercado Libre — mismo patrón de cliente
// que ya usa productAiService.js (ecommerce), pero acá el texto es SIEMPRE plano (ML no
// soporta HTML en la descripción, a diferencia de la ficha de producto de la tienda propia).
import OpenAI from "openai";

let _client = null;
function getClient() {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY no configurada");
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

// Título de Mercado Libre: máximo 60 caracteres, sin datos de contacto/condiciones de venta.
export async function suggestTitle(productName, categoryName) {
  const ai  = getClient();
  const res = await ai.chat.completions.create({
    model:       "gpt-4o-mini",
    max_tokens:  60,
    temperature: 0.5,
    messages: [
      {
        role:    "system",
        content: `Sos un experto en publicar productos en Mercado Libre Argentina.
Generá un título de publicación de MÁXIMO 60 caracteres, en base al nombre del producto y su categoría.
Reglas: incluí lo esencial (tipo de producto + características distintivas), nada de precio/cuotas/envío/datos de contacto, sin mayúsculas sostenidas artificiales, sin emojis.
Respondé SOLO el título, sin comillas ni explicación.`,
      },
      {
        role:    "user",
        content: `Producto: "${productName}"${categoryName ? `\nCategoría: "${categoryName}"` : ""}`,
      },
    ],
  });
  return res.choices[0].message.content.trim().replace(/^"|"$/g, "").slice(0, 60);
}

// Descripción plana (sin HTML) para Mercado Libre — expande lo que ya cargó el vendedor,
// nunca inventa specs que no estén en el nombre/descripción original.
export async function suggestDescription(productName, existingDescription) {
  const ai  = getClient();
  const res = await ai.chat.completions.create({
    model:       "gpt-4o-mini",
    max_tokens:  500,
    temperature: 0.6,
    messages: [
      {
        role:    "system",
        content: `Sos un experto redactor de publicaciones para Mercado Libre Argentina.
Expandí y mejorá la descripción del vendedor, usándola como única fuente — no inventes medidas,
materiales ni especificaciones que no haya mencionado.
Formato: texto plano (Mercado Libre no acepta HTML), párrafos cortos, tono claro y comercial.
Devolvé SOLO el texto de la descripción, sin explicaciones ni markdown.`,
      },
      {
        role:    "user",
        content: `Producto: "${productName}"\nDescripción del vendedor: "${existingDescription || "(sin descripción, generá una genérica acorde al nombre)"}"`,
      },
    ],
  });
  return res.choices[0].message.content.trim();
}

// Sugiere valores para atributos todavía vacíos — si el atributo tiene una lista fija de
// valores (attr.values), tiene que elegir UNO de esos nombres tal cual, nunca inventar uno
// nuevo (rompería la publicación). Si no tiene lista, propone texto libre corto.
export async function suggestAttributeValues(productName, existingDescription, categoryName, attrDefs) {
  if (!attrDefs.length) return {};
  const ai = getClient();

  const attrList = attrDefs.map(a => {
    const options = a.values?.length ? ` — opciones válidas: ${a.values.slice(0, 30).map(v => v.name).join(", ")}` : "";
    return `- id="${a.id}" nombre="${a.name}"${options}`;
  }).join("\n");

  const res = await ai.chat.completions.create({
    model:           "gpt-4o-mini",
    max_tokens:      500,
    temperature:     0.3,
    response_format: { type: "json_object" },
    messages: [
      {
        role:    "system",
        content: `Sos un experto en publicar productos en Mercado Libre Argentina.
Te doy un producto y una lista de atributos de su categoría todavía sin completar. Para cada uno, proponé el valor más probable.
Si el atributo tiene "opciones válidas", tenés que responder EXACTAMENTE uno de esos textos, tal cual está escrito — nunca inventes uno nuevo.
Si no tiene opciones (es texto libre), proponé un valor corto y realista.
Si genuinamente no podés inferir un valor razonable para alguno, no lo incluyas en la respuesta (mejor omitirlo que inventar).
Respondé SOLO JSON: { "valores": { "<id_del_atributo>": "<valor>", ... } }`,
      },
      {
        role:    "user",
        content: `Producto: "${productName}"\nDescripción: "${existingDescription || "(sin descripción)"}"\nCategoría: "${categoryName || "(sin especificar)"}"\n\nAtributos a completar:\n${attrList}`,
      },
    ],
  });

  try {
    const parsed = JSON.parse(res.choices[0].message.content);
    return parsed.valores || {};
  } catch {
    return {};
  }
}

// Genera una foto de producto de estudio (fondo liso, sin marcas de agua) para usar como
// imagen de la publicación — pensada específicamente para Mercado Libre, no para la ficha de
// producto de la tienda propia (que puede usar fotos más "lifestyle").
export async function generateProductImage(productName, description) {
  const ai = getClient();
  const prompt = `Fotografía de producto profesional de estudio para publicar en Mercado Libre (marketplace de e-commerce de Argentina).
Producto: "${productName}".${description ? ` Detalles: ${description}.` : ""}

Requisitos estrictos de la foto:
- Fondo blanco o gris muy claro, completamente liso, sin sombras duras ni decorados.
- El producto centrado en el cuadro, ocupando la mayor parte de la imagen, bien enfocado y nítido.
- Iluminación uniforme tipo estudio fotográfico, sin reflejos exagerados.
- Ángulo que muestre el producto completo y sus detalles principales.
- SIN texto, SIN logos superpuestos, SIN marcas de agua, SIN manos ni personas.
- Estilo fotorrealista (no ilustración, no render 3D estilizado, no dibujo) — como una foto de catálogo real.`;

  const res = await ai.images.generate({
    model:  "gpt-image-1",
    prompt,
    size:   "1024x1024",
    n:      1,
  });

  const b64 = res.data[0]?.b64_json;
  if (!b64) throw new Error("La IA no devolvió ninguna imagen");
  return Buffer.from(b64, "base64");
}

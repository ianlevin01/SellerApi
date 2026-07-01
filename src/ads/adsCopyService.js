import OpenAI, { toFile } from "openai";
import { uploadBuffer } from "../utils/s3Client.js";

let _client = null;
function getClient() {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY no configurada");
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

const OBJECTIVES = {
  sales:      "generar ventas directas (conversiones)",
  traffic:    "llevar tráfico al sitio",
  awareness:  "dar a conocer la marca",
  leads:      "conseguir contactos interesados",
};

export async function generateAdCopy({ productName, productDesc, price, objective = "sales", context = "", storeName = "" }) {
  const ai = getClient();
  const objText = OBJECTIVES[objective] || "generar ventas";

  const res = await ai.chat.completions.create({
    model:           "gpt-4o-mini",
    max_tokens:      900,
    temperature:     0.8,
    response_format: { type: "json_object" },
    messages: [
      {
        role:    "system",
        content: `Sos un experto en publicidad digital para el mercado argentino, especializado en Meta Ads (Facebook e Instagram).
Tu tarea es generar copy para anuncios basándote en los datos del producto.

Reglas:
- Tono: argentino, natural, cercano. Nada de "¡¡¡" excesivos ni emojis en el headline.
- Headline: máximo 40 caracteres. Directo, sin puntos al final.
- Primary text: 2-3 oraciones impactantes. Podés usar 1-2 emojis. Máximo 125 caracteres para la versión corta.
- Description: 1 oración que complementa. Máximo 30 caracteres.
- CTA: uno de: "Comprar ahora", "Ver más", "Conocé más", "Pedir ahora", "Contactar".
- Generá siempre 3 variantes distintas (A = directa/urgencia, B = aspiracional/beneficio, C = social proof/curiosidad).

Respondé SOLO con JSON con esta estructura exacta:
{
  "variants": [
    { "variant": "A", "label": "Urgencia / Directa", "headline": "...", "primary_text": "...", "description": "...", "cta": "..." },
    { "variant": "B", "label": "Beneficio / Aspiracional", "headline": "...", "primary_text": "...", "description": "...", "cta": "..." },
    { "variant": "C", "label": "Curiosidad / Social proof", "headline": "...", "primary_text": "...", "description": "...", "cta": "..." }
  ]
}`,
      },
      {
        role:    "user",
        content: `Producto: "${productName}"
${productDesc ? `Descripción: "${productDesc}"` : ""}
${price ? `Precio: $${price}` : ""}
${storeName ? `Tienda: "${storeName}"` : ""}
Objetivo de la campaña: ${objText}
${context ? `Contexto adicional: "${context}"` : ""}

Generá el copy para este anuncio.`,
      },
    ],
  });

  try {
    return JSON.parse(res.choices[0].message.content);
  } catch {
    throw new Error("Error al parsear respuesta de IA");
  }
}

// Generate a single copy field (headline, primary_text, or description)
export async function generateSingleField({ field, productName, productDesc, price, objective = "sales", context = "", existingCopy = {} }) {
  const ai = getClient();
  const objText = OBJECTIVES[objective] || "generar ventas";

  const fieldRules = {
    headline:     "Headline: máximo 40 caracteres, directo, sin puntos al final, sin emojis.",
    primary_text: "Primary text: 2-3 oraciones impactantes, podés usar 1-2 emojis, máximo 125 caracteres.",
    description:  "Description: 1 oración breve que complementa, máximo 30 caracteres.",
  };

  const res = await ai.chat.completions.create({
    model:           "gpt-4o-mini",
    max_tokens:      200,
    temperature:     0.85,
    response_format: { type: "json_object" },
    messages: [
      {
        role:    "system",
        content: `Sos un experto en publicidad digital para el mercado argentino, especializado en Meta Ads.
Generás únicamente el campo "${field}" para un anuncio.
Regla: ${fieldRules[field] || "Texto breve y directo."}
Tono: argentino, natural, cercano.
Respondé SOLO con JSON: { "value": "el texto generado" }`,
      },
      {
        role:    "user",
        content: `Producto: "${productName}"
${productDesc ? `Descripción: "${productDesc}"` : ""}
${price ? `Precio: $${price}` : ""}
Objetivo: ${objText}
${context ? `Contexto: "${context}"` : ""}
${existingCopy.headline ? `Headline actual: "${existingCopy.headline}"` : ""}
${existingCopy.primary_text ? `Texto actual: "${existingCopy.primary_text}"` : ""}

Generá solo el campo: ${field}`,
      },
    ],
  });

  const parsed = JSON.parse(res.choices[0].message.content);
  return parsed.value || "";
}

// Generate advertising image (uses product reference photo when available)
export async function generateAdImage({ prompt, productName, productDesc, format = "feed", style = "clean", imageBuffer = null }) {
  const ai = getClient();

  const styleGuide = {
    clean:     "Clean, professional composition with soft neutral background. Warm studio lighting. Product is the clear hero. Advertising-ready, polished look.",
    lifestyle: "Lifestyle advertising scene. The product in real-world use, aspirational environment, natural warm light. Evokes emotion and desire.",
    bold:      "Bold, high-impact advertising creative. Vibrant colors, dramatic lighting, dynamic composition. Eye-catching and modern.",
    minimal:   "Minimalist advertising aesthetic. Elegant, generous white space, subtle shadows. Premium and luxurious feel.",
  };

  const formatContext = {
    feed:      "Instagram/Facebook feed (square format). Thumb-stopping visual for a social media scroll.",
    story:     "Instagram/Facebook Story (vertical format). Full-screen immersive ad.",
    reel:      "Instagram Reel ad (vertical format). Dynamic, energetic visual.",
    carousel:  "Carousel ad slide (square format). Clear product focus.",
  };

  const isPortrait = ["story", "reel"].includes(format);
  const size = isPortrait ? "1024x1536" : "1024x1024";

  let res;
  try {
    if (imageBuffer) {
      // Use product photo as reference for an advertising creative
      const imageFile = await toFile(imageBuffer, "product.png", { type: "image/png" });

      const editPrompt = [
        `Transform this product photo into a compelling advertising creative for ${formatContext[format] || "social media"}.`,
        `The product must remain clearly recognizable and be the main subject.`,
        `Visual style: ${styleGuide[style] || styleGuide.clean}`,
        `Do not add any text, watermarks, logos, or overlays.`,
        prompt ? `Creative direction: ${prompt}.` : "",
      ].filter(Boolean).join(" ");

      console.log("[adsCopyService:generateAdImage] usando images.edit, prompt:", editPrompt.slice(0, 120));

      res = await ai.images.edit({
        model:  "gpt-image-1-mini",
        image:  imageFile,
        prompt: editPrompt,
        n:      1,
        size,
        quality: "medium",
      });
    } else {
      // No reference photo — generate from description
      const genPrompt = [
        `Advertising creative for a social media ad (${formatContext[format] || format}).`,
        `Product: "${productName}".`,
        productDesc ? `Description: "${productDesc}".` : "",
        `Visual style: ${styleGuide[style] || styleGuide.clean}`,
        `Do not include any text, watermarks, logos, or overlays.`,
        prompt ? `Creative direction: ${prompt}.` : "",
      ].filter(Boolean).join(" ");

      console.log("[adsCopyService:generateAdImage] usando images.generate, prompt:", genPrompt.slice(0, 120));

      res = await ai.images.generate({
        model:   "gpt-image-1-mini",
        prompt:  genPrompt,
        n:       1,
        size,
        quality: "medium",
      });
    }
  } catch (e) {
    console.error("[adsCopyService:generateAdImage] OpenAI error:", e?.status, e?.message, JSON.stringify(e?.error ?? {}));
    throw e;
  }

  const b64 = res.data[0].b64_json;
  console.log("[adsCopyService:generateAdImage] respuesta OK, b64 length:", b64?.length);

  const key       = `ads/generated/${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
  const buffer    = Buffer.from(b64, "base64");
  const signedUrl = await uploadBuffer(key, buffer, "image/png");

  console.log("[adsCopyService:generateAdImage] subido a S3, key:", key);
  return { url: signedUrl, revised_prompt: null };
}

// Campaign agent chat
export async function chatWithAgent({ message, campaignsContext, history = [] }) {
  const ai = getClient();

  const systemPrompt = `Sos un experto en publicidad digital y Meta Ads para el mercado argentino.
Ayudás a vendedores a optimizar sus campañas de Facebook e Instagram Ads.

DATOS DEL VENDEDOR (usá estos datos para responder con información específica):
${campaignsContext}

Tus capacidades:
- Analizar campañas y creativos del vendedor
- Recomendar estrategias de Meta Ads para el mercado argentino
- Explicar métricas (ROAS, CPM, CTR, CPC, conversiones)
- Ayudar con copy, segmentación, presupuesto
- Responder dudas sobre el funcionamiento de Meta Ads
- Analizar rentabilidad de campañas

Reglas:
- Respondé en español argentino (tuteo, "vos")
- Sé conciso pero completo
- Cuando menciones números, usá los datos reales del vendedor si están disponibles
- Si no tenés datos suficientes para algo, decilo claramente
- Nunca inventés métricas de campañas que no están en los datos`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...history.slice(-10), // Últimos 10 mensajes de contexto
    { role: "user", content: message },
  ];

  const res = await ai.chat.completions.create({
    model:       "gpt-4o",
    max_tokens:  800,
    temperature: 0.7,
    messages,
  });

  return res.choices[0].message.content;
}

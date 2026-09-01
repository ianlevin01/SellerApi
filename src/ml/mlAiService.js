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
//
// El título tiene que identificar el producto, no venderlo — la estructura que pide ML es
// producto + marca + modelo + 2 o 3 especificaciones que realmente lo diferencian (no todas
// las specs existentes, eso lo vuelve ilegible y desperdicia espacio). Tiene que leerse como
// el nombre exacto de un producto en un catálogo, no como un anuncio.
export async function suggestTitle(productName, categoryName) {
  const ai  = getClient();
  const res = await ai.chat.completions.create({
    model:       "gpt-4o-mini",
    max_tokens:  60,
    temperature: 0.5,
    messages: [
      {
        role:    "system",
        content: `Sos un experto en publicar productos en Mercado Libre Argentina, siguiendo al pie de la letra sus reglas oficiales de títulos.

Estructura del título: [producto] + [marca] + [modelo, si existe] + [2 o 3 especificaciones que realmente diferencian a este producto de otros similares].
No agregues todas las especificaciones posibles — solo las que más importan para identificarlo o encontrarlo (ej. capacidad, tamaño, color, conectividad, la que sea relevante para ESTE producto puntual).

Prohibido:
- Palabras de venta o promoción: "oferta", "promoción", "imperdible", "el mejor", "envío gratis", "cuotas", "MercadoLíder", "Full", "descuento", o cualquier signo de exclamación.
- Indicar si es nuevo, usado o reacondicionado (eso va en otro campo de la publicación).
- Repetir palabras o información.
- Mayúsculas sostenidas artificiales, emojis, símbolos o signos de puntuación decorativos.
- Abreviaturas innecesarias — escribí las palabras completas salvo que la abreviatura sea la forma en que un comprador realmente buscaría (ej. "220V" está bien).
- Palabras sin relación real con el producto solo para aparecer en más búsquedas.

Si el producto es genérico o compatible con una marca de otro fabricante (ej. un repuesto o accesorio), usá "para [marca]" — nunca "tipo", "símil" o "igual a".

Usá las palabras que un comprador realmente escribiría para buscar este producto, con ortografía correcta. MÁXIMO 60 caracteres.
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

// Arma el content de un mensaje de usuario con imágenes reales del producto (si hay) — permite
// que el modelo vea el producto en vez de adivinar a ciegas a partir del título/descripción.
function buildUserContent(text, imageUrls) {
  if (!imageUrls?.length) return text;
  return [
    { type: "text", text },
    ...imageUrls.slice(0, 4).map(url => ({ type: "image_url", image_url: { url } })),
  ];
}

// Descripción plana (sin HTML) para Mercado Libre — expande lo que ya cargó el vendedor,
// apoyándose en las fotos reales del producto cuando están disponibles (en vez de inventar
// medidas/materiales que no se mencionaron ni se ven en la imagen).
//
// El título identifica; la descripción resuelve las dudas que quedan después de identificar
// el producto. Tiene que ser informativa pero comercial — ni un anuncio con frases vacías
// ("¡no te lo podés perder!") ni una ficha técnica fría e ilegible. Cada frase tiene que
// aportar algo concreto para decidir la compra; si no aporta, sobra.
export async function suggestDescription(productName, existingDescription, imageUrls = []) {
  const ai  = getClient();
  const res = await ai.chat.completions.create({
    model:       "gpt-4o-mini",
    max_tokens:  500,
    temperature: 0.6,
    messages: [
      {
        role:    "system",
        content: `Sos un experto redactor de publicaciones para Mercado Libre Argentina, siguiendo sus reglas oficiales de descripciones.

Expandí y mejorá la descripción del vendedor con esta estructura (adaptala, no la sigas como una plantilla rígida — un producto simple necesita menos que uno técnico):
1. Una o dos frases: qué es el producto y para quién/qué está pensado.
2. Sus características principales y qué beneficio concreto le da al comprador cada una (no solo enumerar specs — explicar qué significan para el uso real).
3. Especificaciones importantes que no queden claras solo con el título (capacidad, medidas, materiales, alimentación, etc. — lo que aplique).
4. Qué incluye la compra (accesorios, manual, cable, etc., si corresponde).
5. Cualquier dato que evite una pregunta antes de comprar: compatibilidad, instalación, forma de uso, garantía, condiciones relevantes.

Si te paso fotos del producto, mirá lo que se ve en ellas (color, materiales, forma, accesorios incluidos, etc.) y usalo como fuente además del texto — no inventes nada que no esté mencionado ni sea visible en las fotos. Nunca contradigas datos que ya dio el vendedor.

Prohibido: frases publicitarias vacías ("¡no te lo podés perder!", "¡la mejor oportunidad!", "¡comprá ya!"), exageraciones, y cualquier dato inventado que no puedas respaldar con el texto del vendedor o las fotos.

Formato: texto plano (Mercado Libre no acepta HTML), párrafos cortos, tono claro y comercial — no un tono de venta agresivo ni una ficha técnica fría.
Devolvé SOLO el texto de la descripción, sin explicaciones ni markdown.`,
      },
      {
        role:    "user",
        content: buildUserContent(
          `Producto: "${productName}"\nDescripción del vendedor: "${existingDescription || "(sin descripción, generá una genérica acorde al nombre y, si hay fotos, a lo que se ve en ellas)"}"`,
          imageUrls,
        ),
      },
    ],
  });
  return res.choices[0].message.content.trim();
}

// Sugiere valores para atributos todavía vacíos — si el atributo tiene una lista fija de
// valores (attr.values), tiene que elegir UNO de esos nombres tal cual, nunca inventar uno
// nuevo (rompería la publicación). Si no tiene lista, propone texto libre corto.
// Con fotos del producto, el modelo puede inferir color/material/forma en vez de adivinar
// casi al azar a partir del título — esto es lo que evita respuestas erráticas.
export async function suggestAttributeValues(productName, existingDescription, categoryName, attrDefs, imageUrls = []) {
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

Completar bien estos datos importa: Mercado Libre los usa como filtros de búsqueda, así que un atributo bien cargado ayuda a que el producto aparezca en más búsquedas relevantes — no son campos decorativos.

Regla más importante: NUNCA inventes un dato que no podés respaldar. Si te paso fotos del producto, priorizá lo que se ve en ellas (color, material, forma, cantidad de piezas, etc.) por sobre suposiciones genéricas del título. Un dato falso hace que el producto aparezca en búsquedas equivocadas y genera devoluciones y reclamos — es preferible dejar el atributo sin completar.

Si el atributo tiene "opciones válidas", tenés que responder EXACTAMENTE uno de esos textos, tal cual está escrito — nunca inventes uno nuevo. Si entre esas opciones está "No aplica" y el atributo genuinamente no corresponde a este producto (no porque no sepas el dato), elegí esa. No uses "No aplica" como comodín para no pensar el valor real.
Si el atributo es "Marca" y el producto no tiene una marca real conocida, respondé "Genérica" en vez de omitirlo.
Si no tiene opciones (es texto libre), proponé un valor corto y realista, solo si podés justificarlo con el nombre, la descripción o las fotos.
Si genuinamente no podés inferir un valor razonable para alguno (ni por texto ni por foto), no lo incluyas en la respuesta — mejor omitirlo que inventar.
Respondé SOLO JSON: { "valores": { "<id_del_atributo>": "<valor>", ... } }`,
      },
      {
        role:    "user",
        content: buildUserContent(
          `Producto: "${productName}"\nDescripción: "${existingDescription || "(sin descripción)"}"\nCategoría: "${categoryName || "(sin especificar)"}"\n\nAtributos a completar:\n${attrList}`,
          imageUrls,
        ),
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

// La API de generación de imágenes (images.generate) no acepta fotos de referencia — es
// texto→imagen puro. Para que el resultado se parezca al producto real (no a un genérico
// inventado a partir del nombre), primero se le pide al modelo de visión que describa en
// palabras lo que ve en las fotos del catálogo, y esa descripción visual es la que después
// alimenta el prompt de generación.
export async function describeProductForImageGen(productName, imageUrls = []) {
  if (!imageUrls.length) return "";
  const ai = getClient();
  const res = await ai.chat.completions.create({
    model:       "gpt-4o-mini",
    max_tokens:  200,
    temperature: 0.2,
    messages: [
      {
        role:    "system",
        content: `Describí en un párrafo corto el aspecto visual exacto del producto de estas fotos: color(es) precisos, forma, material aparente, diseño/estampado, y cualquier detalle distintivo (mango, textura, patrón, etc.). Es para que otro modelo de IA genere una foto de estudio del mismo producto sin verlo — sé lo más concreto y literal posible, sin opiniones ni marketing. Respondé SOLO la descripción visual.`,
      },
      {
        role:    "user",
        content: buildUserContent(`Producto: "${productName}"`, imageUrls),
      },
    ],
  });
  return res.choices[0].message.content.trim();
}

// Genera una foto de producto para usar como imagen de la publicación — pensada
// específicamente para Mercado Libre, no para la ficha de producto de la tienda propia (que
// puede usar fotos más "lifestyle" sin las mismas restricciones).
//
// userPrompt es lo que pide el vendedor (ej. "mostralo sobre una mesada de cocina", "un
// primer plano de la pantalla") — es el contenido de la imagen. Las reglas de abajo son la
// forma: cómo tiene que verse cualquier imagen para no tener problemas en Mercado Libre, sea
// cual sea el contenido pedido. Sin userPrompt, el default es fondo blanco de estudio — es la
// opción válida en prácticamente todas las categorías y obligatoria en varias (Tecnología,
// Belleza, Salud, Supermercado), así que es el default más seguro cuando el vendedor no
// especificó un contexto puntual.
export async function generateProductImage(productName, description, userPrompt) {
  const ai = getClient();
  const contentInstruction = userPrompt
    ? `Lo que pidió el vendedor para esta foto: ${userPrompt}.`
    : `Fondo blanco puro, liso, tipo estudio fotográfico — sin decorado ni contexto.`;

  const prompt = `Fotografía de producto profesional para publicar en Mercado Libre (marketplace de e-commerce de Argentina).
Producto: "${productName}".${description ? ` Aspecto real del producto (respetalo estrictamente, no inventes otro color/forma/diseño distinto a este): ${description}.` : ""}

${contentInstruction}

Reglas de composición que se aplican siempre, sea cual sea el contexto de la foto:
- El producto es el protagonista absoluto: centrado, ocupando aproximadamente el 95% del cuadro, bien enfocado y nítido, sin márgenes vacíos excesivos.
- Bien iluminado, sin sombras duras que oculten detalles ni reflejos que quemen partes del producto.
- Mostrá el producto completo (no cortado ni parcialmente fuera de cuadro), salvo que el pedido sea explícitamente un primer plano de un detalle puntual.
- Si se pide un fondo con contexto (ej. sobre una mesa, en una habitación), el entorno tiene que ser simple y no competir visualmente con el producto — nada de otros productos, personas, manos, ni objetos que puedan confundirse con accesorios incluidos si no lo están.
- SIN texto superpuesto, SIN logos, SIN marcas de agua, SIN códigos QR, SIN datos de contacto o redes sociales, SIN carteles de "oferta", "envío gratis", "Full" ni ningún elemento promocional.
- Estilo fotorrealista — una foto de catálogo real, nunca una ilustración, render 3D estilizado, dibujo ni infografía con flechas o texto explicativo.`;

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

import OpenAI from "openai";
import * as repo from "./storeRepository.js";

let _openai = null;
function getOpenAI() {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY)
      throw { status: 503, message: "La función de IA no está configurada en el servidor." };
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

const EDITABLE_FIELDS = `
store_name         - Nombre de la tienda
store_description  - Descripción de la tienda (1-3 frases)
tagline            - Frase corta debajo del nombre (slogan)
hero_headline      - Título principal del banner de inicio
promo_text         - Texto de barra promocional (ej: "¡Envío gratis en compras +$50.000!")
show_promo_bar     - Mostrar barra promocional (true/false)
banner_color       - Color principal en hex (ej: "#4db81a")
color_secondary    - Color secundario en hex
color_bg           - Color de fondo en hex
color_text         - Color de texto principal en hex
font_family        - Tipografía: "Inter", "Playfair Display", "Roboto", "Poppins", "Montserrat", "Lato", "Nunito"
card_border_radius - Radio de bordes de cards (número entero en px, ej: 4, 8, 12, 16, 24)
card_show_shadow   - Sombra en cards (true/false)
meta_title         - Título SEO de la página
meta_description   - Descripción SEO (150-160 caracteres)
`.trim();

export async function buildPageWithAI(sellerId, pageId, userRequest) {
  const page = await repo.getPageById(pageId, sellerId);
  if (!page) throw { status: 404, message: "Tienda no encontrada" };

  const currentConfig = {
    store_name:         page.store_name,
    store_description:  page.store_description,
    tagline:            page.tagline,
    hero_headline:      page.hero_headline,
    promo_text:         page.promo_text,
    show_promo_bar:     page.show_promo_bar,
    banner_color:       page.banner_color,
    color_secondary:    page.color_secondary,
    color_bg:           page.color_bg,
    color_text:         page.color_text,
    font_family:        page.font_family,
    card_border_radius: page.card_border_radius,
    card_show_shadow:   page.card_show_shadow,
    meta_title:         page.meta_title,
    meta_description:   page.meta_description,
  };

  const systemPrompt = `Sos un experto en diseño de tiendas online. Ayudás a vendedores a configurar su tienda virtual en base a lo que te piden.

Campos que podés modificar:
${EDITABLE_FIELDS}

Configuración actual de la tienda:
${JSON.stringify(currentConfig, null, 2)}

Reglas:
- Respondé SOLO con un JSON válido con los campos a modificar. No incluyas campos que no necesitan cambiar.
- Para colores, usá siempre formato hex (#rrggbb).
- Sé creativo y profesional. Adaptá el diseño al rubro/estilo que pide el vendedor.
- Si el vendedor pide algo general como "hacela moderna" o "más llamativa", inferí los cambios apropiados.
- No incluyas campos de imágenes ni URLs.`;

  const completion = await getOpenAI().chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userRequest },
    ],
    temperature: 0.7,
    max_tokens:  800,
  });

  let updates;
  try {
    updates = JSON.parse(completion.choices[0].message.content);
  } catch {
    throw { status: 500, message: "La IA no pudo generar una configuración válida. Intentá de nuevo." };
  }

  // Solo aplicar campos permitidos y sanitizarlos
  const allowed = new Set(Object.keys(currentConfig));
  const raw = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.has(k)));

  // Sanitizar tipos para que coincidan con las columnas de la BD
  const safe = { ...raw };
  if ("card_border_radius" in safe) {
    // smallint: strip "px" si viene como "8px", parsear a entero
    const n = parseInt(String(safe.card_border_radius), 10);
    safe.card_border_radius = isNaN(n) ? null : n;
  }
  if ("show_promo_bar"  in safe) safe.show_promo_bar  = Boolean(safe.show_promo_bar);
  if ("card_show_shadow" in safe) safe.card_show_shadow = Boolean(safe.card_show_shadow);

  const validSafe = Object.fromEntries(Object.entries(safe).filter(([, v]) => v !== null && v !== undefined));

  if (Object.keys(validSafe).length === 0)
    throw { status: 400, message: "No se detectaron cambios para aplicar." };

  // updatePage necesita todos los campos del página actual como base; fusionamos el safe encima
  await repo.updatePage(pageId, sellerId, { ...page, ...validSafe });

  return {
    applied: validSafe,
    message: `Se aplicaron ${Object.keys(validSafe).length} cambios a tu tienda.`,
  };
}

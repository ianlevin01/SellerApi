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
banner_color       - Color principal en hex (ej: "#4db81a"). Afecta: botones, precios, badge de carrito.
color_secondary    - Color secundario en hex
color_bg           - Color de fondo general de la tienda en hex (ej: "#ffffff", "#f8f5f0")
color_text         - Color de texto principal en hex (ej: "#111111")
navbar_color       - Color de fondo de la barra de navegación en hex. Deja vacío ("") para usar el color principal (banner_color).
promo_color        - Color de fondo de la barra promocional en hex. Deja vacío ("") para usar el color principal.
footer_bg          - Color de fondo del footer en hex. Deja vacío ("") para usar el default del tema.
footer_text_color  - Color de texto del footer en hex. Deja vacío ("") para usar el default del tema.
font_family        - Tipografía: "Inter", "Playfair Display", "Roboto", "Poppins", "Montserrat", "Lato", "Nunito"
card_border_radius - Radio de bordes de cards en px (ej: 0=cuadrado, 8=redondeado suave, 16=muy redondeado, 99=pill)
card_show_shadow   - Sombra en cards (true/false)
meta_title         - Título SEO de la página
meta_description   - Descripción SEO (150-160 caracteres)
`.trim();

// These fields live inside theme_config JSONB, not as top-level columns
const THEME_CONFIG_FIELDS = new Set(["navbar_color", "promo_color", "footer_bg", "footer_text_color"]);

const LAYOUT_COLOR_AREAS = {
  recife:   "navbar_color → navbar principal oscura; promo_color → topbar dorada/acento superior (encima de la navbar)",
  brasilia: "navbar_color → navbar oscura; promo_color → barra de acento superior (por default usa banner_color)",
  lima:     "navbar_color → navbar (Lima es BLANCA por defecto — sugerí colores claros como '#ffffff' o un tono suave; evitá oscuro a menos que el vendedor lo pida)",
  amazonas: "navbar_color → navbar oscura principal; promo_color → topbar de acento superior",
  standard: "navbar_color → barra de navegación principal",
};

const LAYOUT_INFO = `
Layouts disponibles (el activo YA está elegido — NO cambiarlo):
- standard: navbar clásica + hero + grilla de productos
- recife: beauty/moda premium, 3 capas de header, sidebar de categorías, badges verticales
- brasilia: tech/gaming, barra promo integrada, hero split, carruseles
- lima: joyería/premium, navbar blanca/minimal, logo centrado, imágenes portrait
- amazonas: marketplace, búsqueda central, secciones por categoría

Áreas de color en los layouts: navbar_color controla la navbar; promo_color controla la barra de acento/topbar.
IMPORTANTE: lima tiene navbar blanca por defecto — si el estilo es minimal/luminoso, dejá navbar_color como "" o usá un color muy claro.
`;

export async function buildPageWithAI(sellerId, pageId, userRequest) {
  const page = await repo.getPageById(pageId, sellerId);
  if (!page) throw { status: 404, message: "Tienda no encontrada" };

  const tc = page.theme_config || {};
  const currentLayout = tc.layout || "standard";
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
    navbar_color:       tc.navbar_color  || "",
    promo_color:        tc.promo_color   || "",
    footer_bg:          tc.footer_bg     || "",
    footer_text_color:  tc.footer_text_color || "",
    font_family:        page.font_family,
    card_border_radius: page.card_border_radius,
    card_show_shadow:   page.card_show_shadow,
    meta_title:         page.meta_title,
    meta_description:   page.meta_description,
  };

  const layoutColorHint = LAYOUT_COLOR_AREAS[currentLayout] || LAYOUT_COLOR_AREAS.standard;

  const systemPrompt = `Sos un experto en diseño de tiendas online. Ayudás a vendedores a configurar la apariencia de su tienda virtual en base a lo que te piden.

Campos que podés modificar:
${EDITABLE_FIELDS}

${LAYOUT_INFO}

Layout activo: "${currentLayout}"
Color areas de este layout: ${layoutColorHint}

Configuración actual de la tienda:
${JSON.stringify(currentConfig, null, 2)}

Reglas:
- Respondé SOLO con un JSON válido con los campos a modificar. No incluyas campos que no necesitan cambiar.
- Para colores, usá siempre formato hex (#rrggbb). Elegí colores que contrasten bien entre sí.
- Sé creativo y profesional. Adaptá el diseño al rubro/estilo que pide el vendedor.
- Si el vendedor pide algo general como "hacela moderna", "más llamativa", "estilo minimalista", inferí los cambios apropiados de colores, tipografía y textos.
- Si piden un "tema" (tech, lujo, juvenil, natural, etc.), adaptá banner_color, color_bg, color_text, navbar_color y font_family de forma coherente con el layout activo.
- Al cambiar el estilo general, siempre incluí navbar_color y promo_color (si aplica al layout) para que toda la interfaz sea cohesiva.
- No incluyas campos de imágenes ni URLs.
- No incluyas "layout_id" ni campos de layout estructural — esos se manejan por separado.
- navbar_color, promo_color, footer_bg, footer_text_color SÍ los podés cambiar. Usalos cuando el pedido implique colorear esas áreas. Pasalos como hex (#rrggbb) o "" para resetear al default del tema.`;

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

  // Allow empty string for theme_config color fields (means "reset to default")
  const validSafe = Object.fromEntries(
    Object.entries(safe).filter(([k, v]) => {
      if (THEME_CONFIG_FIELDS.has(k)) return v !== null && v !== undefined;
      return v !== null && v !== undefined;
    })
  );

  if (Object.keys(validSafe).length === 0)
    throw { status: 400, message: "No se detectaron cambios para aplicar." };

  // Split: top-level columns vs theme_config JSONB sub-fields
  const topLevel    = {};
  const themeUpdates = {};
  for (const [k, v] of Object.entries(validSafe)) {
    if (THEME_CONFIG_FIELDS.has(k)) themeUpdates[k] = v;
    else topLevel[k] = v;
  }

  const updatedPage = { ...page, ...topLevel };
  if (Object.keys(themeUpdates).length > 0) {
    updatedPage.theme_config = { ...(page.theme_config || {}), ...themeUpdates };
  }

  await repo.updatePage(pageId, sellerId, updatedPage);

  return {
    applied: validSafe,
    message: `Se aplicaron ${Object.keys(validSafe).length} cambios a tu tienda.`,
  };
}

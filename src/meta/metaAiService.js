import OpenAI from "openai";
import * as metaSvc from "./metaService.js";

const ACTION_TOOLS = [
  // ── LECTURA ──────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "get_campaigns",
      description: "Lista las campañas de Meta Ads del vendedor con estado, presupuesto e ID.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_insights",
      description: "Obtiene métricas de rendimiento de la cuenta: gasto, impresiones, clics, CTR, conversiones.",
      parameters: {
        type: "object",
        properties: {
          date_preset: {
            type: "string",
            enum: ["today", "yesterday", "last_7d", "last_30d", "this_month", "last_month"],
            description: "Período. Default: last_7d",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_ad_sets",
      description: "Lista los conjuntos de anuncios de una campaña.",
      parameters: {
        type: "object",
        properties: {
          campaign_id: { type: "string", description: "ID de la campaña. Si no se provee, lista todos." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_ads",
      description: "Lista los anuncios de un conjunto de anuncios.",
      parameters: {
        type: "object",
        properties: {
          adset_id: { type: "string", description: "ID del conjunto de anuncios." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_pages",
      description: "Obtiene las Páginas de Facebook del vendedor (necesarias para crear creativos).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_pixels",
      description: "Lista los Píxeles de Meta configurados en la cuenta publicitaria.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_ad_images",
      description: "Lista las imágenes disponibles en la biblioteca de anuncios de la cuenta.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "search_interests",
      description: "Busca intereses de audiencia en Meta para usar en el targeting del conjunto de anuncios.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Término a buscar, ej: 'moda femenina', 'tecnología', 'fitness'" },
        },
        required: ["query"],
      },
    },
  },

  // ── CAMPAÑAS ─────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "create_campaign",
      description: "Crea una nueva campaña en Meta Ads. Es el primer paso del flujo de creación.",
      parameters: {
        type: "object",
        properties: {
          name:             { type: "string", description: "Nombre de la campaña" },
          objective:        {
            type: "string",
            enum: ["OUTCOME_SALES", "OUTCOME_TRAFFIC", "OUTCOME_AWARENESS", "OUTCOME_LEADS", "OUTCOME_ENGAGEMENT"],
            description: "Objetivo: OUTCOME_SALES para ventas/conversiones, OUTCOME_TRAFFIC para tráfico al sitio, OUTCOME_AWARENESS para reconocimiento de marca, OUTCOME_LEADS para captar contactos, OUTCOME_ENGAGEMENT para interacciones",
          },
          status:           { type: "string", enum: ["ACTIVE", "PAUSED"], description: "Default: PAUSED" },
          daily_budget_ars: { type: "number", description: "Presupuesto diario en ARS a nivel campaña (CBO, opcional)" },
        },
        required: ["name", "objective"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pause_campaign",
      description: "Pausa una campaña activa.",
      parameters: {
        type: "object",
        properties: {
          campaign_id:   { type: "string" },
          campaign_name: { type: "string", description: "Nombre para confirmar al usuario" },
        },
        required: ["campaign_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "activate_campaign",
      description: "Activa una campaña pausada.",
      parameters: {
        type: "object",
        properties: {
          campaign_id:   { type: "string" },
          campaign_name: { type: "string" },
        },
        required: ["campaign_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_budget",
      description: "Cambia el presupuesto diario de una campaña en pesos argentinos.",
      parameters: {
        type: "object",
        properties: {
          campaign_id:      { type: "string" },
          campaign_name:    { type: "string" },
          daily_budget_ars: { type: "number", description: "Nuevo presupuesto diario en ARS" },
        },
        required: ["campaign_id", "daily_budget_ars"],
      },
    },
  },

  // ── CONJUNTOS DE ANUNCIOS ─────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "create_ad_set",
      description: "Crea un conjunto de anuncios dentro de una campaña. Define audiencia, presupuesto y optimización.",
      parameters: {
        type: "object",
        properties: {
          campaign_id:         { type: "string", description: "ID de la campaña padre" },
          campaign_objective:  { type: "string", description: "Objetivo de la campaña (para configurar optimización automáticamente)" },
          name:                { type: "string", description: "Nombre del conjunto de anuncios" },
          daily_budget_ars:    { type: "number", description: "Presupuesto diario en ARS (mínimo ~500)" },
          optimization_goal:   {
            type: "string",
            enum: ["OFFSITE_CONVERSIONS", "LINK_CLICKS", "LANDING_PAGE_VIEWS", "REACH", "IMPRESSIONS", "LEAD_GENERATION", "POST_ENGAGEMENT"],
            description: "Objetivo de optimización. Para ventas: OFFSITE_CONVERSIONS. Para tráfico: LANDING_PAGE_VIEWS. Para awareness: REACH.",
          },
          pixel_id:            { type: "string", description: "ID del Pixel (obligatorio para OFFSITE_CONVERSIONS)" },
          conversion_event:    {
            type: "string",
            enum: ["PURCHASE", "ADD_TO_CART", "INITIATE_CHECKOUT", "VIEW_CONTENT", "LEAD", "COMPLETE_REGISTRATION", "SEARCH"],
            description: "Evento de conversión del pixel. Para e-commerce usar PURCHASE.",
          },
          destination_url:     { type: "string", description: "URL del sitio web destino (para referencia)" },
          age_min:             { type: "number", description: "Edad mínima (18-65). Default: 18" },
          age_max:             { type: "number", description: "Edad máxima (18-65). Default: 65" },
          genders:             { type: "string", enum: ["all", "male", "female"], description: "Género. Default: all" },
          countries:           { type: "array", items: { type: "string" }, description: "Códigos de países. Default: ['AR']" },
          interests:           {
            type: "array",
            items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } },
            description: "Intereses obtenidos con search_interests",
          },
          start_time:          { type: "string", description: "Fecha y hora de inicio en ISO 8601. Default: ahora" },
          end_time:            { type: "string", description: "Fecha y hora de fin en ISO 8601 (opcional)" },
          status:              { type: "string", enum: ["ACTIVE", "PAUSED"], description: "Default: PAUSED" },
          use_instagram:       { type: "boolean", description: "Incluir Instagram en los placements. Default: true. Usar false si la cuenta no tiene Instagram vinculado." },
        },
        required: ["campaign_id", "name", "daily_budget_ars", "optimization_goal"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_ad_set",
      description: "Modifica un conjunto de anuncios existente (presupuesto, estado, nombre).",
      parameters: {
        type: "object",
        properties: {
          adset_id:        { type: "string" },
          status:          { type: "string", enum: ["ACTIVE", "PAUSED"] },
          daily_budget_ars:{ type: "number" },
          name:            { type: "string" },
        },
        required: ["adset_id"],
      },
    },
  },

  // ── CREATIVOS Y ANUNCIOS ──────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "create_ad_creative",
      description: "Crea el creativo del anuncio: imagen, texto y botón. Necesitás la Página de Facebook y el contenido visual.",
      parameters: {
        type: "object",
        properties: {
          name:        { type: "string", description: "Nombre interno del creativo" },
          page_id:     { type: "string", description: "ID de la Página de Facebook que publica el anuncio (obtener con get_pages)" },
          link:        { type: "string", description: "URL de destino del anuncio (tu tienda o producto)" },
          message:     { type: "string", description: "Texto principal del anuncio (el que aparece arriba de la imagen)" },
          headline:    { type: "string", description: "Titular del anuncio (texto en negrita debajo de la imagen)" },
          description: { type: "string", description: "Descripción adicional (opcional, aparece bajo el titular)" },
          cta_type:    {
            type: "string",
            enum: ["SHOP_NOW", "LEARN_MORE", "SIGN_UP", "CONTACT_US", "GET_QUOTE", "BOOK_TRAVEL", "DOWNLOAD", "WATCH_MORE"],
            description: "Botón de llamada a la acción. Para tiendas: SHOP_NOW.",
          },
          image_url:   { type: "string", description: "URL pública de la imagen del anuncio (1200x628px recomendado)" },
          image_hash:  { type: "string", description: "Hash de imagen ya subida a la biblioteca (alternativa a image_url)" },
        },
        required: ["name", "page_id", "link", "message", "headline"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_ad",
      description: "Crea el anuncio final asignando un creativo a un conjunto de anuncios. Último paso del flujo.",
      parameters: {
        type: "object",
        properties: {
          name:        { type: "string", description: "Nombre del anuncio" },
          campaign_id: { type: "string" },
          adset_id:    { type: "string" },
          creative_id: { type: "string", description: "ID del creativo creado con create_ad_creative" },
          status:      { type: "string", enum: ["ACTIVE", "PAUSED"], description: "Default: PAUSED" },
        },
        required: ["name", "campaign_id", "adset_id", "creative_id"],
      },
    },
  },
];

const TOOL_LABELS = {
  get_campaigns:     "Campañas cargadas",
  get_insights:      "Métricas obtenidas",
  get_ad_sets:       "Conjuntos cargados",
  get_ads:           "Anuncios cargados",
  get_pages:         "Páginas obtenidas",
  get_pixels:        "Píxeles obtenidos",
  get_ad_images:     "Imágenes obtenidas",
  search_interests:  "Intereses buscados",
  create_campaign:   "Campaña creada",
  pause_campaign:    "Campaña pausada",
  activate_campaign: "Campaña activada",
  update_budget:     "Presupuesto actualizado",
  create_ad_set:     "Conjunto creado",
  update_ad_set:     "Conjunto actualizado",
  create_ad_creative:"Creativo creado",
  create_ad:         "Anuncio creado",
};

async function executeTool(name, args, connection) {
  const { access_token: token, ad_account_id } = connection;
  switch (name) {
    case "get_campaigns":
      return metaSvc.getCampaigns(token, ad_account_id);

    case "get_insights": {
      const preset = args.date_preset || "last_7d";
      const [acct, byCampaign] = await Promise.all([
        metaSvc.getAccountInsights(token, ad_account_id, preset),
        metaSvc.getCampaignsInsights(token, ad_account_id, preset),
      ]);
      return { account: acct, by_campaign: byCampaign };
    }

    case "get_ad_sets":
      return metaSvc.getAdSets(token, ad_account_id, args.campaign_id);

    case "get_ads":
      return metaSvc.getAds(token, ad_account_id, args.adset_id);

    case "get_pages":
      return metaSvc.getPages(token);

    case "get_pixels":
      return metaSvc.getPixels(token, ad_account_id);

    case "get_ad_images":
      return metaSvc.getAdImages(token, ad_account_id);

    case "search_interests":
      return metaSvc.searchInterests(token, args.query);

    case "create_campaign":
      return metaSvc.createCampaign(token, ad_account_id, args);

    case "pause_campaign":
      return metaSvc.setCampaignStatus(token, args.campaign_id, "PAUSED");

    case "activate_campaign":
      return metaSvc.setCampaignStatus(token, args.campaign_id, "ACTIVE");

    case "update_budget":
      return metaSvc.setCampaignBudget(token, args.campaign_id, args.daily_budget_ars);

    case "create_ad_set":
      return metaSvc.createAdSet(token, ad_account_id, args);

    case "update_ad_set":
      return metaSvc.updateAdSet(token, args.adset_id, args);

    case "create_ad_creative":
      return metaSvc.createAdCreative(token, ad_account_id, args);

    case "create_ad":
      return metaSvc.createAd(token, ad_account_id, args);

    default:
      return { error: "Herramienta desconocida" };
  }
}

let _client = null;
function getClient() {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY no configurada");
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

const SYSTEM_CONNECTED = `
ACCESO REAL ACTIVO: Tenés herramientas conectadas directamente a la cuenta publicitaria del vendedor y podés ejecutar acciones reales en Meta.

═══════════════════════════════════════════════
FLUJO DE CREACIÓN DE CAMPAÑA — 4 PASOS
═══════════════════════════════════════════════

PASO 1 — CAMPAÑA (create_campaign):
Datos a pedir: nombre, objetivo.
Objetivos disponibles:
• OUTCOME_SALES → Para vender productos / generar conversiones en la tienda
• OUTCOME_TRAFFIC → Para llevar visitas al sitio web
• OUTCOME_AWARENESS → Para dar a conocer la marca
• OUTCOME_LEADS → Para captar contactos (formularios)
• OUTCOME_ENGAGEMENT → Para conseguir interacciones (me gustas, comentarios)
Tip: Para tiendas online siempre recomendá OUTCOME_SALES con pixel.

PASO 2 — CONJUNTO DE ANUNCIOS (create_ad_set):
Datos obligatorios:
• campaign_id (del paso 1)
• Nombre del conjunto
• Presupuesto diario en ARS (mínimo recomendado: $1.000/día)
• Audiencia: edad mínima/máxima, género, intereses (buscá con search_interests)
• Para OUTCOME_SALES: pixel_id + conversion_event (casi siempre PURCHASE)
• Para OUTCOME_TRAFFIC: solo URL de destino
• use_instagram: true por defecto (Facebook + Instagram).
  ⚠️ ERROR DE INSTAGRAM: Si create_ad_creative falla con "Permissions error" o menciona Instagram, seguí este flujo de recuperación automática:
  1. Creá un nuevo conjunto de anuncios idéntico pero con use_instagram: false
  2. Reintentá create_ad_creative con el nuevo conjunto
  3. Creá el anuncio normalmente
  4. Avisale al usuario: "✅ Anuncio creado, pero solo para Facebook. Tu cuenta publicitaria no tiene una cuenta de Instagram vinculada. Si querés que aparezca en Instagram también, entrá a Meta Business Suite → Configuración del negocio → Cuentas de Instagram y vinculá tu cuenta."
Optimización automática según objetivo:
• OUTCOME_SALES → OFFSITE_CONVERSIONS (necesita pixel)
• OUTCOME_TRAFFIC → LANDING_PAGE_VIEWS
• OUTCOME_AWARENESS → REACH
• OUTCOME_LEADS → LEAD_GENERATION
• OUTCOME_ENGAGEMENT → POST_ENGAGEMENT
Siempre crear en PAUSED salvo que el usuario pida activarlo.

PASO 3 — CREATIVO (create_ad_creative):
Datos obligatorios:
• page_id (SIEMPRE obtenerlo con get_pages primero — NUNCA pedir el ID al usuario)
  → Si hay UNA sola página: usala directamente sin preguntar
  → Si hay MÁS de una: mostrá los nombres y preguntá cuál usar
• URL de destino (link)
• Texto principal (message) — el texto que aparece arriba de la imagen
• Titular (headline) — texto en negrita debajo de la imagen
• Imagen: image_url (URL pública) o image_hash (de biblioteca, obtener con get_ad_images)
• CTA: SHOP_NOW para tiendas, LEARN_MORE para marca, SIGN_UP para leads
Nota: Si no tienen imagen, pediles una URL pública de imagen. Recomendá 1200x628px para feed.

PASO 4 — ANUNCIO (create_ad):
Une el creativo con el conjunto. Datos: campaign_id, adset_id, creative_id, nombre, status.
Este es el último paso. Al terminar, confirmá que todo quedó creado y preguntá si quieren activarlo.

═══════════════════════════════════════════════
GESTIÓN DE EXISTENTES
═══════════════════════════════════════════════
• Ver campañas: get_campaigns
• Ver métricas: get_insights (pedí el período si no lo especifican)
• Ver conjuntos: get_ad_sets con campaign_id
• Ver anuncios: get_ads con adset_id
• Pausar/activar campaña: pause_campaign / activate_campaign
• Cambiar presupuesto de campaña: update_budget
• Cambiar presupuesto/estado de conjunto: update_ad_set
• Buscar intereses: search_interests (antes de crear un conjunto)

═══════════════════════════════════════════════
CÓMO GUIAR AL USUARIO
═══════════════════════════════════════════════
• Si dice "quiero crear una campaña" → preguntá objetivo en lenguaje simple: ¿querés vender, llevar tráfico o dar a conocer tu marca?
• NUNCA pedirle al usuario un ID (de página, pixel, conjunto, etc.) — siempre buscalos con la herramienta correspondiente y mostrá los nombres para que elijan
• Si necesitás el pixel → get_pixels, si hay uno solo usarlo directo, si hay varios mostrar nombres y preguntar cuál
• Si no saben qué imagen usar → mostrá las disponibles con get_ad_images
• Si no saben intereses → buscá opciones relevantes con search_interests y mostráselas
• Explicá cada concepto en términos simples, sin jargon técnico
• Para cada cosa que creás, confirmá el ID y nombre al usuario
• Argentina por defecto: países = ["AR"], moneda = ARS
• Presupuesto mínimo sugerido: $1.000 ARS/día por conjunto

═══════════════════════════════════════════════
REGLA CRÍTICA
═══════════════════════════════════════════════
Cuando el usuario pide que ejecutes algo, LO HACÉS INMEDIATAMENTE con la herramienta. No pedís confirmación previa, no decís "no puedo". Si necesitás datos que no tenés (page_id, pixel_id, etc.), los buscás primero con la herramienta correspondiente. Ejecutás y reportás el resultado.
`;

const SYSTEM_NO_CONNECTION = `
El vendedor NO tiene Meta conectado o no seleccionó una cuenta publicitaria aún. Podés asesorarlo sobre estrategia, estructura de campañas, copy y presupuesto, pero avisale que primero necesita conectar su cuenta de Meta desde el panel de arriba para poder ejecutar acciones reales.
`;

export async function runMetaAgent({ message, history = [], connection }) {
  const ai = getClient();
  const hasConnection = !!(connection?.access_token && connection?.ad_account_id);

  const systemPrompt = `Sos el asistente de publicidad de Ventaz, especializado en Meta Ads para el mercado argentino. Ayudás a los vendedores a crear, gestionar y optimizar sus campañas de Facebook e Instagram — incluso si no saben nada de publicidad.

${hasConnection ? SYSTEM_CONNECTED : SYSTEM_NO_CONNECTION}

Reglas de comunicación:
- Respondé en español argentino, con "vos"
- Sé claro, concreto y amigable — muchos usuarios son vendedores sin experiencia en publicidad
- Cuando creás algo, mostrá el ID resultante y el nombre para que el usuario lo pueda identificar
- Los presupuestos siempre en ARS ($)
- No inventes métricas ni IDs — usá las herramientas para obtenerlos
- Al terminar un flujo completo de creación, hacé un resumen de todo lo que quedó creado`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...history.slice(-20),
    { role: "user", content: message },
  ];

  const executedActions = [];

  for (let i = 0; i < 10; i++) {
    const res = await ai.chat.completions.create({
      model:       "gpt-4o",
      max_tokens:  2000,
      temperature: 0.3,
      messages,
      ...(hasConnection ? { tools: ACTION_TOOLS, tool_choice: "auto" } : {}),
    });

    const msg = res.choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls?.length) {
      return { reply: msg.content, actions: executedActions };
    }

    const toolResults = [];
    for (const call of msg.tool_calls) {
      let args;
      try { args = JSON.parse(call.function.arguments || "{}"); } catch { args = {}; }
      let result;
      let ok = true;
      try {
        result = await executeTool(call.function.name, args, connection);
      } catch (err) {
        console.error("[metaAgent] tool error:", call.function.name, err.message);
        result = { error: err.message };
        ok = false;
      }
      executedActions.push({ tool: call.function.name, args, result, ok });
      toolResults.push({
        role:         "tool",
        tool_call_id: call.id,
        content:      JSON.stringify(result),
      });
    }
    messages.push(...toolResults);
  }

  return { reply: "No pude completar la acción. Intentá de nuevo o dividila en pasos más chicos.", actions: executedActions };
}

export { TOOL_LABELS };

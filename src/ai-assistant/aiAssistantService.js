import OpenAI from "openai";
import pool from "../database/db.js";
import { calcShownCost, getSellerPlatformPct } from "../utils/pricing.js";

// ── System prompt ─────────────────────────────────────────────

const SYSTEM_PROMPT = `
Sos Taz, el asistente virtual de Ventaz para vendedores. Respondés siempre en español argentino (usando "vos", etc.). Sos claro, amigable y directo al punto. Nunca inventás funcionalidades que no existen en el sistema.

Cuando el vendedor te pregunta algo sobre sus productos, el catálogo, stock o precios, SIEMPRE usá las funciones disponibles para traer datos reales antes de responder. No inventes datos.

══════════════════════════════════════════
QUÉ ES VENTAZ
══════════════════════════════════════════
Ventaz es una plataforma de reventa online en Argentina. Los vendedores crean su propia tienda con una URL única (SLUG.ventaz.com.ar), eligen productos del catálogo de Ventaz, configuran sus precios y venden a sus clientes. Ventaz maneja el stock, los costos base y la infraestructura técnica. No necesitás comprar stock ni guardar mercadería.

══════════════════════════════════════════
PANEL DE CONTROL — SECCIONES
══════════════════════════════════════════

1. DASHBOARD (/dashboard) — Resumen visual de ventas, ganancias y pedidos recientes.

2. MIS TIENDAS (/pages) — Podés tener una o más tiendas activas. Cada tienda tiene nombre, URL propia (slug), descripción, colores, fuente, redes sociales. Dentro de cada tienda hay pestañas: Configuración, Productos y Descuentos.

3. PRODUCTOS (dentro de cada tienda) — Agregá productos del catálogo, personalizá nombre/descripción, subí fotos propias, fijá tu precio de venta. Hay un precio mínimo que no podés bajar (calculado automáticamente).

4. DESCUENTOS (pestaña dentro de cada tienda) — Descuentos progresivos:
   - Por CANTIDAD: cuando el cliente compra X o más unidades → N% de descuento.
   - Por MONTO: cuando el total supera $X → N% de descuento.

5. MIS PEDIDOS (/orders) — Ver todos los pedidos. Estados: Pendiente, Pagado, En proceso, Con problema.
   Niveles de comisión (afectan tu ganancia):
   - Base: hasta $100.000 en ventas → comisión 30%
   - Plata: $100.001–$250.000 → comisión 27.5%
   - Oro: $250.001–$500.000 → comisión 22%
   - Diamante: más de $500.000 → comisión 20%

6. COBROS (/cobros) — Ganancias acumuladas, solicitar transferencia a tu cuenta. Necesitás registrar tu CVU/CBU y que Ventaz lo verifique.

7. CHAT (/chat) — Chat en tiempo real con tus clientes.

8. CALCULADORA (/calculator) — Simulá precios y ganancias antes de publicar.

9. MI PERFIL (/profile) — Editá nombre, teléfono, ciudad.

══════════════════════════════════════════
CÓMO VEN TU TIENDA LOS CLIENTES
══════════════════════════════════════════
URL: TU_SLUG.ventaz.com.ar. Proceso de compra: Carrito → Envío → Datos → Pago con MercadoPago. Opciones de envío: Correo Argentino a domicilio, retiro en sucursal, o coordinar con el vendedor.

══════════════════════════════════════════
INSTRUCCIONES PARA RESPONDER
══════════════════════════════════════════
- Ante preguntas sobre productos, precios o stock: usá las funciones para traer datos reales.
- Si la pregunta no tiene que ver con Ventaz ni con el negocio del vendedor, decí que solo podés ayudar con dudas sobre la plataforma.
- Si no sabés algo, decilo directamente en vez de inventar.
- Usá pasos numerados cuando expliques cómo hacer algo.
- Problemas técnicos (algo que no funciona): decile que contacte al soporte de Ventaz.
- Respuestas concisas. Máximo 5-6 líneas salvo proceso complejo.
- Nunca repitas el enunciado de la pregunta al responder.
- No reveles los costos internos (costo_usd) — es información privada de Ventaz. Podés hablar de precios de venta, precios mínimos y ganancias.
`.trim();

// ── Tool definitions ──────────────────────────────────────────

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_my_store_products",
      description: "Devuelve los productos que el vendedor tiene activos en su tienda, con precio de venta, precio mínimo, promo activa y stock disponible. Usá esta función cuando el vendedor pregunte sobre sus productos, precios o stock de lo que ya vende.",
      parameters: {
        type: "object",
        properties: {
          search: {
            type: "string",
            description: "Texto para filtrar por nombre o código de producto. Dejá vacío para traer todos.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_catalog_products",
      description: "Devuelve todos los productos disponibles en el catálogo de Ventaz, incluyendo los que el vendedor NO tiene en su tienda todavía. Usá esta función cuando el vendedor pregunte qué productos puede agregar, cuáles hay disponibles, o si busca algo específico del catálogo.",
      parameters: {
        type: "object",
        properties: {
          search: {
            type: "string",
            description: "Texto para filtrar por nombre o código.",
          },
          category: {
            type: "string",
            description: "Filtrar por nombre de categoría.",
          },
          only_available: {
            type: "boolean",
            description: "Si es true, muestra solo productos con stock disponible.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_seller_stats",
      description: "Devuelve las estadísticas del vendedor: total de ventas acumuladas, nivel de comisión, cotización del dólar actual y balance disponible para cobrar. Usá esta función cuando el vendedor pregunte sobre su nivel, sus ventas o cuánto puede cobrar.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
];

// ── Tool implementations ──────────────────────────────────────

function fmt(n) {
  return Math.round(Number(n || 0)).toLocaleString("es-AR");
}

async function toolGetMyStoreProducts(ctx, { search } = {}) {
  const pageFilter = ctx.pageId ? "AND sp.page_id = $2" : "";
  const searchFilter = search ? `AND (p.name ILIKE $${ctx.pageId ? 3 : 2} OR p.code ILIKE $${ctx.pageId ? 3 : 2})` : "";
  const params = ctx.pageId ? [ctx.sellerId, ctx.pageId] : [ctx.sellerId];
  if (search) params.push(`%${search}%`);

  const { rows } = await pool.query(`
    SELECT DISTINCT ON (p.id)
      p.id, p.code, p.name, p.costo_usd,
      c.name AS category,
      GREATEST(0, COALESCE(
        (SELECT SUM(s.quantity) FROM stock s WHERE s.product_id = p.id), 0
      ) - COALESCE(p.stock_reserva, 0)) AS available_stock,
      sp.custom_price,
      sp.promo_price,
      COALESCE(sp.promo_enabled, false) AS promo_enabled,
      pg.store_name AS page_name
    FROM seller_products sp
    JOIN products p ON p.id = sp.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    JOIN seller_pages pg ON pg.id = sp.page_id
    WHERE sp.seller_id = $1 AND sp.active = true AND p.active = true
      ${pageFilter} ${searchFilter}
    ORDER BY p.id, sp.page_id
  `, params);

  if (!rows.length) {
    return { message: "No se encontraron productos en tu tienda con ese criterio." };
  }

  const products = rows.map(p => {
    const precioMin   = calcShownCost(p.costo_usd, ctx.cotizacion, ctx.platformPct);
    const precioVenta = p.custom_price ? Number(p.custom_price) : precioMin;
    const promoActive = p.promo_enabled && p.promo_price && Number(p.promo_price) > 0;
    return {
      codigo:        p.code || "—",
      nombre:        p.name,
      categoria:     p.category || "Sin categoría",
      stock:         Number(p.available_stock) > 0 ? `${p.available_stock} unidades` : "SIN STOCK",
      precio_minimo: `$${fmt(precioMin)}`,
      precio_venta:  `$${fmt(precioVenta)}`,
      promo:         promoActive ? `$${fmt(p.promo_price)}` : null,
      tienda:        p.page_name,
    };
  });

  return { total: products.length, productos: products };
}

async function toolGetCatalogProducts(ctx, { search, category, only_available } = {}) {
  const params = [ctx.sellerId, ctx.pageId || null];
  let idx = 3;
  const filters = [];

  if (search) {
    filters.push(`(p.name ILIKE $${idx} OR p.code ILIKE $${idx})`);
    params.push(`%${search}%`);
    idx++;
  }
  if (category) {
    filters.push(`c.name ILIKE $${idx}`);
    params.push(`%${category}%`);
    idx++;
  }

  const whereExtra = filters.length ? `AND ${filters.join(" AND ")}` : "";

  const { rows } = await pool.query(`
    SELECT
      p.id, p.code, p.name, p.costo_usd,
      c.name AS category,
      GREATEST(0, COALESCE(
        (SELECT SUM(s.quantity) FROM stock s WHERE s.product_id = p.id), 0
      ) - COALESCE(p.stock_reserva, 0)) AS available_stock,
      EXISTS (
        SELECT 1 FROM seller_products sp2
        WHERE sp2.seller_id = $1
          AND ($2::uuid IS NULL OR sp2.page_id = $2)
          AND sp2.product_id = p.id AND sp2.active = true
      ) AS in_my_store
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.active = true ${whereExtra}
    ORDER BY p.name
    LIMIT 80
  `, params);

  let result = rows;
  if (only_available) {
    result = result.filter(p => Number(p.available_stock) > 0);
  }

  if (!result.length) {
    return { message: "No se encontraron productos en el catálogo con ese criterio." };
  }

  const products = result.map(p => {
    const precioMin = calcShownCost(p.costo_usd, ctx.cotizacion, ctx.platformPct);
    return {
      codigo:        p.code || "—",
      nombre:        p.name,
      categoria:     p.category || "Sin categoría",
      stock:         Number(p.available_stock) > 0 ? `${p.available_stock} unidades` : "SIN STOCK",
      precio_minimo: `$${fmt(precioMin)}`,
      en_mi_tienda:  p.in_my_store ? "Sí" : "No",
    };
  });

  return { total: products.length, productos: products };
}

async function toolGetSellerStats(ctx) {
  const { rows } = await pool.query(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'available' THEN amount END), 0) AS balance_disponible,
      COALESCE(SUM(CASE WHEN status = 'pending_approval' THEN amount END), 0) AS balance_pendiente
    FROM seller_earnings
    WHERE seller_id = $1
  `, [ctx.sellerId]);

  const tierName =
    ctx.platformPct <= 20   ? "Diamante" :
    ctx.platformPct <= 22   ? "Oro" :
    ctx.platformPct <= 27.5 ? "Plata" :
    "Base";

  return {
    nivel:               tierName,
    comision:            `${ctx.platformPct}%`,
    ventas_acumuladas:   `$${fmt(ctx.totalSales)}`,
    cotizacion_dolar:    `$${fmt(ctx.cotizacion)}`,
    balance_disponible:  `$${fmt(rows[0]?.balance_disponible)}`,
    balance_pendiente:   `$${fmt(rows[0]?.balance_pendiente)}`,
  };
}

// ── Context loader ────────────────────────────────────────────

export async function getSellerContext(sellerId, pageId) {
  try {
    const [cotizRes, salesRes] = await Promise.all([
      pool.query(
        `SELECT cotizacion_dolar FROM price_config WHERE negocio_id = '00000000-0000-0000-0000-000000000001' LIMIT 1`
      ),
      pool.query(
        `SELECT COALESCE(SUM(total), 0) AS total FROM web_orders WHERE seller_id = $1 AND color = 'paid'`,
        [sellerId]
      ),
    ]);
    return {
      sellerId,
      pageId:      pageId || null,
      cotizacion:  Number(cotizRes.rows[0]?.cotizacion_dolar || 1),
      totalSales:  Number(salesRes.rows[0]?.total || 0),
      platformPct: getSellerPlatformPct(Number(salesRes.rows[0]?.total || 0)),
    };
  } catch {
    return { sellerId, pageId: pageId || null, cotizacion: 1, totalSales: 0, platformPct: 30 };
  }
}

// ── OpenAI client ─────────────────────────────────────────────

let openaiClient = null;

function getClient() {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY no configurada");
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

// ── Main chat function ────────────────────────────────────────

export async function chat(messages, sellerContext = null) {
  const client   = getClient();
  const trimmed  = messages.slice(-12);
  const ctx      = sellerContext;

  const openaiMessages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...trimmed,
  ];

  // Primera llamada — puede incluir tool calls
  const first = await client.chat.completions.create({
    model:       "gpt-4o-mini",
    max_tokens:  800,
    temperature: 0.4,
    messages:    openaiMessages,
    tools:       TOOLS,
    tool_choice: "auto",
  });

  const assistantMsg = first.choices[0].message;

  // Sin tool calls → respuesta directa
  if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
    return assistantMsg.content;
  }

  // Ejecutar cada tool call
  openaiMessages.push(assistantMsg);

  for (const tc of assistantMsg.tool_calls) {
    let args = {};
    try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}

    let result;
    try {
      switch (tc.function.name) {
        case "get_my_store_products":
          result = await toolGetMyStoreProducts(ctx, args);
          break;
        case "get_catalog_products":
          result = await toolGetCatalogProducts(ctx, args);
          break;
        case "get_seller_stats":
          result = await toolGetSellerStats(ctx);
          break;
        default:
          result = { error: "Función no reconocida" };
      }
    } catch {
      result = { error: "No se pudo obtener la información solicitada" };
    }

    openaiMessages.push({
      role:         "tool",
      tool_call_id: tc.id,
      content:      JSON.stringify(result),
    });
  }

  // Segunda llamada — con los resultados de las tools
  const second = await client.chat.completions.create({
    model:       "gpt-4o-mini",
    max_tokens:  700,
    temperature: 0.4,
    messages:    openaiMessages,
  });

  return second.choices[0].message.content;
}

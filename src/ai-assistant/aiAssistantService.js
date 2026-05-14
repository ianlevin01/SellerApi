import OpenAI from "openai";
import pool from "../database/db.js";
import { calcShownCost, getSellerPlatformPct } from "../utils/pricing.js";

const BASE_SYSTEM_PROMPT = `
Sos Taz, el asistente virtual de Ventaz para vendedores. Respondés siempre en español argentino (usando "vos", etc.). Sos clara, amigable y directa al punto. Nunca inventás funcionalidades que no existen en el sistema.

══════════════════════════════════════════
QUÉ ES VENTAZ
══════════════════════════════════════════
Ventaz es una plataforma de reventa online en Argentina. Los vendedores crean su propia tienda con una URL única (SLUG.ventaz.com.ar), eligen productos del catálogo de Ventaz, configuran sus precios y venden a sus clientes. Ventaz maneja el stock, los costos base y la infraestructura técnica. No necesitás comprar stock ni guardar mercadería.

══════════════════════════════════════════
PANEL DE CONTROL — SECCIONES
══════════════════════════════════════════

1. DASHBOARD (/dashboard)
   - Resumen visual de tus ventas, ganancias y pedidos recientes.

2. MIS TIENDAS (/pages)
   - Podés tener una o más tiendas activas al mismo tiempo.
   - Cada tienda tiene: nombre, URL propia (slug), descripción, colores personalizados, fuente, tagline, redes sociales (WhatsApp, Instagram, Facebook).
   - Dentro de cada tienda hay pestañas: "Configuración", "Productos" y "Descuentos".
   - Tu URL de tienda pública es: TU_SLUG.ventaz.com.ar

3. PRODUCTOS (dentro de cada tienda)
   - Para agregar productos: Mis tiendas → tu tienda → pestaña "Productos" → buscá del catálogo y tocá "Agregar".
   - Podés personalizar el nombre y descripción de cada producto.
   - Podés subir imágenes propias para los productos.
   - Podés fijar un precio de venta propio. El sistema tiene un precio mínimo que no podés bajar.
   - El precio mínimo se calcula según tu nivel de comisión y la cotización del dólar (todo automático).
   - Si no fijás precio, se usa el precio mínimo automáticamente.

4. DESCUENTOS (dentro de cada tienda, pestaña "Descuentos")
   - Podés ofrecer descuentos progresivos:
     * Por CANTIDAD: cuando el cliente compra X o más unidades, le aplicás N% de descuento.
     * Por MONTO: cuando el total del pedido supera $X, le aplicás N% de descuento.
   - Los descuentos se muestran automáticamente al cliente en el carrito.

5. MIS PEDIDOS (/orders)
   - Ver todos los pedidos que llegaron a tus tiendas.
   - Estados: Pendiente, Pagado, En proceso, Con problema.
   - Las ganancias se calculan según un sistema de tiers basado en tu volumen de ventas:
     * Hasta $100.000 en ventas totales: nivel base (comisión 30%)
     * $100.001 a $250.000: nivel plata (comisión 27.5%)
     * $250.001 a $500.000: nivel oro (comisión 22%)
     * Más de $500.000: nivel diamante (comisión 20%)
   - A menor comisión, mayor es tu ganancia por venta.

6. COBROS (/cobros)
   - Acá ves tus ganancias acumuladas y solicitás transferencias a tu cuenta bancaria.
   - Partes: Datos bancarios (CVU/CBU) · Saldo pendiente · Saldo disponible · Historial de cobros.
   - El botón de transferir está deshabilitado si tu CVU no fue verificado todavía.

7. CHAT (/chat)
   - Chat en tiempo real con los clientes que compraron en tus tiendas.

8. CALCULADORA (/calculator)
   - Herramienta para simular precios y ver cuánto ganarías.

9. MI PERFIL (/profile)
   - Editá tu nombre, teléfono, ciudad y cómo conociste Ventaz.

══════════════════════════════════════════
CÓMO VEN TU TIENDA LOS CLIENTES
══════════════════════════════════════════
- URL de tu tienda: TU_SLUG.ventaz.com.ar
- Los clientes pueden filtrar por categoría y agregar al carrito.
- El proceso de compra: Carrito → Envío → Datos → Pago con MercadoPago.
- Opciones de envío: Correo Argentino a domicilio, Retiro en sucursal, o Coordinar con el vendedor.

══════════════════════════════════════════
PREGUNTAS FRECUENTES
══════════════════════════════════════════
¿Cómo creo mi tienda?
→ Se crea automáticamente cuando te registrás. Entrá a "Mis tiendas" para configurarla.

¿Cómo agrego productos a mi tienda?
→ Mis tiendas → click en tu tienda → pestaña "Productos" → buscá del catálogo y tocá "Agregar".

¿Cómo cambio el precio de un producto?
→ Mis tiendas → tu tienda → pestaña "Productos" → click en el precio del producto → ingresá el nuevo precio.

¿Cuándo me pagan mis ganancias?
→ Cuando llega un pedido pagado, aparece en "Cobros" como saldo pendiente de aprobación. Cuando Ventaz lo aprueba, pasa a disponible y podés pedir la transferencia.

¿Cómo configuro descuentos?
→ Mis tiendas → tu tienda → pestaña "Descuentos". Podés activar descuentos por cantidad o por monto.

¿Puedo tener más de una tienda?
→ Sí, podés crear varias tiendas desde /pages con diferentes nombres, slugs y productos.

¿Cómo registro mi CVU para cobrar?
→ Entrá a "Cobros" en el menú. Completá el CVU/CBU (22 dígitos), el nombre del titular y guardá. Ventaz lo verifica y te habilita para cobrar.

══════════════════════════════════════════
LO QUE NO EXISTE EN EL PANEL
══════════════════════════════════════════
- No podés cambiar tu email de acceso.
- No podés crear productos propios desde cero (solo se usan los del catálogo de Ventaz).
- No podés modificar el estado de los pedidos manualmente.
- No hay función de facturación automática dentro del panel.

══════════════════════════════════════════
INSTRUCCIONES PARA RESPONDER
══════════════════════════════════════════
- Si la pregunta no tiene que ver con usar Ventaz o con tus productos/tienda, decí amablemente que solo podés ayudar con dudas sobre la plataforma y tu negocio en Ventaz.
- Si no sabés algo con certeza, decilo directamente en vez de inventar.
- Usá pasos numerados cuando expliques cómo hacer algo.
- Si el vendedor menciona un problema técnico (algo que no funciona), decile que contacte al soporte de Ventaz.
- Mantené las respuestas concisas. Máximo 5-6 líneas salvo que sea un proceso complejo.
- Nunca repitas el enunciado de la pregunta al responder.
- Cuando respondas sobre productos específicos (precios, stock, categorías), usá la información del bloque "DATOS DE TU CUENTA Y PRODUCTOS" que está arriba.
- No reveles los costos internos de los productos (costo_usd) — esa info es privada de Ventaz. Podés hablar de precios de venta, precios mínimos y ganancias.
`.trim();

function buildSystemPrompt(context) {
  if (!context) return BASE_SYSTEM_PROMPT;

  const fmt = n => Math.round(Number(n || 0)).toLocaleString("es-AR");

  const tierName =
    context.platformPct <= 20   ? "Diamante (20%)" :
    context.platformPct <= 22   ? "Oro (22%)" :
    context.platformPct <= 27.5 ? "Plata (27.5%)" :
    "Base (30%)";

  let contextBlock = `══════════════════════════════════════════
DATOS DE TU CUENTA Y PRODUCTOS
══════════════════════════════════════════
- Total de ventas acumuladas: $${fmt(context.totalSales)}
- Tu nivel de comisión actual: ${tierName}
- Cotización del dólar: $${fmt(context.cotizacion)}
- Productos en tu tienda: ${context.productCount} (${context.outOfStock} sin stock)
`;

  if (context.productLines.length > 0) {
    contextBlock += `\nDetalle de productos:\n${context.productLines.join("\n")}`;
  } else {
    contextBlock += `\n(No tenés productos cargados en esta tienda todavía.)`;
  }

  return contextBlock + "\n\n" + BASE_SYSTEM_PROMPT;
}

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

    const cotizacion  = Number(cotizRes.rows[0]?.cotizacion_dolar || 1);
    const totalSales  = Number(salesRes.rows[0]?.total || 0);
    const platformPct = getSellerPlatformPct(totalSales);

    const pageFilter = pageId ? `AND sp.page_id = $2` : "";
    const params     = pageId ? [sellerId, pageId] : [sellerId];

    const { rows: products } = await pool.query(`
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
        ${pageFilter}
      ORDER BY p.id, sp.page_id
    `, params);

    const fmt = n => Math.round(Number(n || 0)).toLocaleString("es-AR");

    const productLines = products.map(p => {
      const precioMin   = calcShownCost(p.costo_usd, cotizacion, platformPct);
      const precioVenta = p.custom_price ? Number(p.custom_price) : precioMin;
      const promoActive = p.promo_enabled && p.promo_price && Number(p.promo_price) > 0;
      const stockStatus = Number(p.available_stock) > 0
        ? `${p.available_stock} u.`
        : "SIN STOCK";

      let line = `- [${p.code || "?"}] ${p.name} | ${p.category || "Sin categoría"} | Stock: ${stockStatus} | Precio mínimo: $${fmt(precioMin)} | Precio venta: $${fmt(precioVenta)}`;
      if (promoActive) line += ` | Promo: $${fmt(p.promo_price)}`;
      if (!pageId)     line += ` | Tienda: ${p.page_name}`;
      return line;
    });

    return {
      cotizacion,
      totalSales,
      platformPct,
      productLines,
      productCount: products.length,
      outOfStock:   products.filter(p => Number(p.available_stock) <= 0).length,
    };
  } catch {
    return null;
  }
}

let openaiClient = null;

function getClient() {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY no configurada");
    }
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

export async function chat(messages, sellerContext = null) {
  const client = getClient();

  const trimmed = messages.slice(-12);

  const response = await client.chat.completions.create({
    model:       "gpt-4o-mini",
    max_tokens:  600,
    temperature: 0.4,
    messages: [
      { role: "system", content: buildSystemPrompt(sellerContext) },
      ...trimmed,
    ],
  });

  return response.choices[0].message.content;
}

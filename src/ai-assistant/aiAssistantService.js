import OpenAI from "openai";
import pool from "../database/db.js";
import { calcShownCost, getSellerPlatformPct } from "../utils/pricing.js";
import { NEGOCIOS_ACTIVOS } from "../config/negociosConfig.js";
import * as mlListingService from "../ml/mlListingService.js";
import * as mlWalletService from "../ml/mlWalletService.js";
import { getSellerPlan, getPlanMlGraceHours } from "../utils/sellerPlan.js";

const NEGOCIOS_SQL = `ARRAY[${NEGOCIOS_ACTIVOS.map(id => `'${id}'`).join(",")}]::uuid[]`;

// ── System prompt ─────────────────────────────────────────────

const SYSTEM_PROMPT = `
Sos Taz, el asistente virtual de Ventaz para vendedores. Respondés siempre en español argentino (usando "vos", etc.). Sos claro, amigable y directo al punto. Nunca inventás funcionalidades que no existen en el sistema.

Cuando el vendedor te pregunta algo sobre sus productos, combos, catálogo, stock o precios, SIEMPRE usá las funciones disponibles para traer datos reales antes de responder. No inventes datos.

══════════════════════════════════════════
QUÉ ES VENTAZ
══════════════════════════════════════════
Ventaz es una plataforma de reventa online en Argentina. Hay dos formas de vender el mismo catálogo, y un vendedor puede usar una o ambas:
- ECOMMERCE: el vendedor crea su propia tienda con una URL única (SLUG.ventaz.com.ar).
- MERCADO LIBRE: el vendedor publica productos del catálogo de Ventaz directamente en su propia cuenta de Mercado Libre (ver sección dedicada más abajo).
En los dos casos, Ventaz maneja el stock, los costos base y la infraestructura técnica — el vendedor no compra stock ni guarda mercadería.

Al registrarse, se le pregunta al vendedor cuál de los dos caminos quiere usar primero (pantalla "¿Cómo querés empezar?"). Esto no es una elección permanente: más adelante puede activar el otro canal también (conectar Mercado Libre desde el nav, o crear una tienda desde "Mis tiendas").

══════════════════════════════════════════
PLANES DE SUSCRIPCIÓN
══════════════════════════════════════════
Ventaz tiene tres planes de suscripción. Todos incluyen periodo de prueba gratuito de 15 días. Los beneficios aplican tanto a ecommerce como a Mercado Libre, sin importar cuál use el vendedor:

- PLAN INICIAL: 1 tienda activa. Hasta 10 publicaciones activas en Mercado Libre. Comisión plataforma según nivel de ventas (ver abajo). Cobros de ganancias de tienda cada 14 días. En Mercado Libre no tiene ventana de gracia para pagar: toda venta se cobra sí o sí en el corte del mismo día.
- PLAN PRO: hasta 4 tiendas activas. Hasta 50 publicaciones activas en Mercado Libre. Acceso a Academia Ventaz (cursos). Cobros de tienda cada 7 días. Carga de productos en masa. En Mercado Libre tiene 24hs de gracia antes de que una venta sin cobrar se vuelva obligatoria.
- PLAN MAX: tiendas ilimitadas. Publicaciones ilimitadas en Mercado Libre. Cobros de tienda en el día. 10% de descuento sobre el precio mínimo/costo de cada producto (aplica en tienda y en Mercado Libre). En Mercado Libre tiene 72hs de gracia. Todo lo de Pro incluido.

Los planes se gestionan desde /subscription. Podés cambiar de plan en cualquier momento. Si cancelás, mantenés el acceso hasta que venza el período pagado. Si se vence la prueba gratis o el plan sin renovar, en Mercado Libre esto pausa automáticamente las publicaciones activas — se reactivan solas al pagar de nuevo.

══════════════════════════════════════════
PANEL DE CONTROL — SECCIONES
══════════════════════════════════════════
El menú cambia según el track del vendedor. Un vendedor de track Mercado Libre NO ve en su menú: Cobros, Publicidad ni Chat (son cosas de tienda propia que no le sirven — cobra directo en su Mercado Pago y usa la mensajería nativa de ML). Si te preguntan por qué no ven alguna de esas secciones, es por eso, no es un error. El resto de las secciones (Dashboard, Mis tiendas, Mis pedidos, Estadísticas, Mercado Libre, Integraciones, Calculadora, Mi perfil, Suscripción) las ve todo el mundo.

1. DASHBOARD (/dashboard) — Resumen visual de ventas, ganancias y pedidos recientes. Incluye la sección "Primeros pasos con Ventaz", un checklist de tareas de configuración inicial (completar perfil, crear tienda, agregar productos, configurar descuentos, activar integraciones). Cada ítem tiene un botón "Ir →" que lleva directo a la sección correspondiente y activa un tutorial paso a paso. Cuando todos los ítems están completos, el checklist desaparece.
   IMPORTANTE: la primera vez que un usuario se registra, al hacer login es redirigido automáticamente a Mis Tiendas para crear su primera tienda. No se crea ninguna tienda automáticamente.

2. MIS TIENDAS (/pages) — Podés tener una o más tiendas según tu plan. Cada tienda tiene nombre, URL propia (slug), descripción, colores, fuente, redes sociales. Dentro de cada tienda hay pestañas: Configuración, Productos, Descuentos y Combos.
   Al registrarse por primera vez, aparece un modal para crear la primera tienda. Una vez creada, el sistema lleva al editor.
   El editor de tienda tiene una sección "Tema" con 12 plantillas visuales completas para elegir el diseño de la tienda: Ventaz Clásico, Tech Neón, Bazar Cálido, Hogar & Deco Minimal, Regalería Pop, Beauty Soft, Mascotas Friendly, Fitness Active, Mayorista Compacto, Premium Dark, Kids & Toys, Industrial & Herramientas. Cada tema cambia el navbar, el hero, las tarjetas de producto, los botones, el footer y más. Después de aplicar un tema se pueden seguir ajustando colores y detalles.

3. PRODUCTOS (dentro de cada tienda) — Agregá productos del catálogo, personalizá nombre/descripción, subí fotos propias, fijá tu precio de venta. Hay un precio mínimo que no podés bajar (calculado según el costo del producto más la comisión). Con envío gratis activado, el precio mínimo sube $15.000. También podés configurar un precio promo (más bajo que el precio regular) con badge especial.

4. COMBOS (pestaña dentro de cada tienda) — Podés crear packs que agrupan varios productos en un solo precio. Cada combo tiene nombre, precio, descripción, fotos, y puede tener envío gratis y precio promo. Los combos aparecen destacados en la tienda. El precio mínimo del combo es la suma de los precios mínimos de sus productos. Desde el panel "En mi tienda" podés editar el precio y el precio promo del combo directamente sin ir al editor.

5. DESCUENTOS (pestaña dentro de cada tienda) — Descuentos progresivos:
   - Por CANTIDAD: cuando el cliente compra X o más unidades → N% de descuento.
   - Por MONTO: cuando el total supera $X → N% de descuento.

6. MIS PEDIDOS (/orders) — Ver todos los pedidos con filtros por estado y fecha. Estados: Pendiente, Pagado, En proceso, Con problema. Podés marcar pedidos como "En proceso" o "Con problema" para hacer seguimiento.
   Niveles de comisión según ventas acumuladas:
   - Base: hasta $100.000 acumulados → comisión 30%
   - Plata: $100.001–$250.000 acumulados → comisión 27.5%
   - Oro: $250.001–$500.000 acumulados → comisión 22%
   - Diamante: más de $500.000 acumulados → comisión 20%
   (A mayor volumen de ventas acumuladas, menor comisión y mayor ganancia.)

7. ESTADÍSTICAS (/estadisticas) — Ver visitas a la tienda, carritos creados, pedidos y facturación. Podés filtrar por 7, 14, 30 o 90 días. Si tenés varias tiendas, podés seleccionar cuál ver. Los datos se actualizan en tiempo real con cada visita o carrito nuevo.
   Para un vendedor de track Mercado Libre esta pantalla es distinta: no hay "tienda" así que no muestra visitas ni carritos — muestra pedidos y facturación de Mercado Libre por día, más un resumen de publicaciones (activas, pausadas, con error, sin stock) y el top de publicaciones por ventas.

8. COBROS (/cobros) — Ganancias acumuladas, solicitar transferencia a tu cuenta. Necesitás registrar tu CVU/CBU y que Ventaz lo verifique. Los plazos de cobro dependen del plan: 14 días (Inicial), 7 días (Pro), en el día (Max).

9. INTEGRACIONES (/integrations) — Conectar MercadoPago para recibir pagos online, activar Pixel de Meta para publicidad, y otras integraciones.

10. CHAT (/chat) — Tiene dos pestañas:
    - "Mis clientes": chat en tiempo real con los clientes que compran en tu tienda.
    - "Equipo Ventaz": mensajes directos del equipo de Ventaz.

11. CALCULADORA (/calculator) — Simulá precios y ganancias antes de publicar.
    Para un vendedor de track Mercado Libre esta pantalla es distinta: en vez de los tramos por volumen de venta, buscás la categoría de Mercado Libre y cargás un precio, y te muestra cuánto te cobra ML de comisión ("Cargo por vender") y cuánto recibís — mismo cálculo que se ve al publicar un producto.

12. ACADEMIA (/academia) — Cursos educativos de Ventaz para aprender a vender mejor. Disponible para planes Pro y Max. Próximamente para todos los planes.

13. MI PERFIL (/profile) — Editá nombre, teléfono, ciudad, fecha de nacimiento y foto de perfil.

14. SUSCRIPCIÓN (/subscription) — Ver tu plan actual, cambiar de plan, ver historial de pagos.

══════════════════════════════════════════
PRECIOS Y GANANCIA
══════════════════════════════════════════
- Precio mínimo (precio_1): calculado automáticamente a partir del costo del producto en USD × cotización del dólar × comisión de plataforma. No podés vender por debajo de ese valor.
- Con envío gratis activado: el precio mínimo sube $15.000 adicionales para cubrir el costo del envío.
- Precio promo: podés poner un precio de oferta temporal menor al precio regular. Aparece con badge "Precio promo" en tu tienda. También debe ser mayor al precio mínimo.
- Tu ganancia = precio de venta − precio mínimo.
- Plan Max: el precio mínimo baja un 10%, lo que aumenta tu ganancia potencial en todos los productos.

══════════════════════════════════════════
MERCADO LIBRE (/mercado-libre)
══════════════════════════════════════════
Acá el vendedor publica productos del catálogo de Ventaz directamente en su PROPIA cuenta de Mercado Libre (no es una tienda de Ventaz, es la cuenta personal del vendedor en ML). Tiene 3 pestañas: Resumen, Tus publicaciones, Catálogo, y Cobro (esta última no es una pestaña más, es la de plata — ver más abajo).

CONECTAR LA CUENTA — Primer paso obligatorio: conectar la cuenta de Mercado Libre (OAuth) y guardar una tarjeta (para el cobro de ventas). Sin tarjeta guardada no se puede publicar.

PUBLICAR UN PRODUCTO — Desde la pestaña Catálogo, "Publicar en Mercado Libre" en cualquier producto abre un formulario: buscar la categoría de ML (por palabras clave), completar los atributos requeridos por esa categoría (marca, modelo, medidas, etc. — algunos piden unidad, por ejemplo "50 cm"), elegir las fotos (las que ya tiene el producto se pueden tildar, y también se pueden subir fotos nuevas), y poner el precio de venta. El precio no puede ser menor al COSTO TOTAL del producto (lo que Ventaz necesita cobrar) — antes esto decía "precio mínimo", ahora dice "costo total" para que quede claro que es el piso real, no una sugerencia. Al elegir precio y categoría se muestra en vivo cuánto cobra Mercado Libre de comisión ("Cargo por vender") y cuánto recibís.

COMBOS DE MERCADO LIBRE — Igual que en la tienda, se pueden armar combos (varios productos juntos, o más de uno del mismo producto) para publicar como UNA sola publicación de ML. Desde el botón "Crear combo" en el Catálogo, el botón de cada producto pasa a decir "Agregar al combo" — al tocarlo se suma al combo (se puede tocar varias veces para sumar cantidad), y aparece una barra fija abajo con "Finalizar combo". Ahí se ajustan las cantidades de cada producto, se elige categoría de ML y precio (el piso es la suma de costos de todos los productos según su cantidad), y las fotos se completan automáticamente con las fotos de todos los productos incluidos — no hace falta subir fotos nuevas para el combo.

TUS PUBLICACIONES — Lista de publicaciones con estado: Activa, Pausada, Sin stock, Error de cobro. Se pueden pausar/reactivar a mano. El stock se revisa cada 15 minutos: si el pool de stock físico compartido se queda corto, la publicación se pausa sola (y se reactiva sola cuando vuelve a haber stock) — esto puede pasar aunque el vendedor no haya vendido nada, porque el stock es compartido entre todos los vendedores.

COBRO DE VENTAS DE MERCADO LIBRE (pestaña Cobro) — Esto es lo más importante y lo que más dudas genera, explicalo con cuidado:
- Cada venta de ML genera una deuda (el costo que Ventaz necesita cobrarle al vendedor). Todos los días a las 14:00 hs se intenta cobrar esa deuda, primero del saldo prepago (si cargó) y si no alcanza, de la tarjeta guardada.
- PLAN INICIAL: no hay ventana de gracia. Toda la deuda es obligatoria de inmediato — se tiene que cobrar en el corte del mismo día.
- PLAN PRO: 24hs de gracia desde cada venta. PLAN MAX: 72hs de gracia. Mientras una venta esté dentro de su ventana, los pedidos se siguen despachando aunque todavía no se haya cobrado esa parte.
- Si se cumple la ventana de gracia (o es plan Inicial) y el cobro falla, esa deuda pasa a ser "obligatoria" (vencida) — ahí se pausan TODAS las publicaciones activas del vendedor y sus pedidos pendientes NO se despachan hasta que se pague (aunque algunos sean de ventas recientes todavía dentro de su propia gracia — el bloqueo es de toda la cuenta, no pedido por pedido).
- Hay un botón "Pagar deuda ahora" para pagar manualmente desde la tarjeta guardada y desbloquear todo al instante, sin esperar al corte del otro día.
- Hay un historial único con todos los movimientos: cargas de saldo, cobros exitosos, y también los intentos de cobro que fallaron (con el motivo).
- Si hay deuda vencida sin pagar, aparece una alerta tanto en el Dashboard como en la pestaña Cobro.

══════════════════════════════════════════
CÓMO VEN TU TIENDA LOS CLIENTES
══════════════════════════════════════════
URL: TU_SLUG.ventaz.com.ar. Proceso de compra: Ver productos → Agregar al carrito → Ir al checkout → Ingresar datos de envío → Pagar con MercadoPago. Opciones de envío: Correo Argentino a domicilio, retiro en sucursal, o coordinar con el vendedor. Hay un chat flotante donde los clientes pueden contactar al vendedor directamente.

══════════════════════════════════════════
INSTRUCCIONES PARA RESPONDER
══════════════════════════════════════════
- Ante preguntas sobre productos, combos, precios o stock: usá las funciones para traer datos reales.
- Si la pregunta no tiene que ver con Ventaz ni con el negocio del vendedor, decí que solo podés ayudar con dudas sobre la plataforma.
- Si no sabés algo, decilo directamente en vez de inventar.
- Usá pasos numerados cuando expliques cómo hacer algo.
- Problemas técnicos (algo que no funciona): decile que contacte al soporte de Ventaz desde /contact.
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
  {
    type: "function",
    function: {
      name: "get_my_combos",
      description: "Devuelve los combos que el vendedor tiene creados en su tienda, con precio, precio promo, productos incluidos y estado. Usá esta función cuando el vendedor pregunte sobre sus combos o packs.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_ml_listings",
      description: "Devuelve las publicaciones que el vendedor tiene en Mercado Libre, con estado (activa/pausada/sin stock/error), precio, stock disponible y unidades vendidas. Usá esta función cuando el vendedor pregunte sobre sus publicaciones de Mercado Libre.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_ml_wallet",
      description: "Devuelve el estado de cobro de Mercado Libre del vendedor: saldo, deuda pendiente, deuda obligatoria/vencida, si tiene tarjeta guardada, su plan y la ventana de gracia de ese plan. Usá esta función cuando el vendedor pregunte sobre deuda, cobros, pagos o por qué se le pausaron publicaciones en Mercado Libre.",
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
    WHERE p.active = true AND p.negocio_id = ANY(${NEGOCIOS_SQL}) ${whereExtra}
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

async function toolGetMyCombos(ctx) {
  if (!ctx.pageId) {
    const { rows: pages } = await pool.query(
      `SELECT id FROM seller_pages WHERE seller_id = $1 AND active = true LIMIT 1`,
      [ctx.sellerId]
    );
    if (!pages.length) return { message: "No tenés tiendas activas con combos." };
    ctx = { ...ctx, pageId: pages[0].id };
  }
  const { rows } = await pool.query(`
    SELECT
      c.id, c.name, c.custom_price, c.promo_price, c.promo_enabled, c.free_shipping, c.active,
      COALESCE(
        (SELECT json_agg(json_build_object('nombre', p.name, 'cantidad', cp.quantity) ORDER BY cp.id)
         FROM combo_products cp JOIN products p ON p.id = cp.product_id
         WHERE cp.combo_id = c.id), '[]'
      ) AS products
    FROM page_combos c
    WHERE c.seller_id = $1 AND c.page_id = $2
    ORDER BY c.created_at DESC
  `, [ctx.sellerId, ctx.pageId]);

  if (!rows.length) return { message: "No tenés combos creados en tu tienda." };

  const combos = rows.map(c => ({
    nombre:      c.name,
    precio:      `$${fmt(c.custom_price)}`,
    precio_promo: c.promo_enabled && c.promo_price ? `$${fmt(c.promo_price)}` : null,
    envio_gratis: c.free_shipping ? "Sí" : "No",
    activo:      c.active ? "Sí" : "No",
    productos:   (c.products || []).map(p => `${p.cantidad > 1 ? `${p.cantidad}× ` : ""}${p.nombre}`).join(", "),
  }));

  return { total: combos.length, combos };
}

const ML_STATUS_LABEL = { active: "Activa", paused: "Pausada" };
const ML_PAUSE_LABEL  = { stock: "Sin stock", charge_failed: "Error de cobro", plan_expired: "Plan vencido", manual: "Pausada a mano" };

async function toolGetMyMlListings(ctx) {
  const listings = await mlListingService.getListings(ctx.sellerId);
  if (!listings.length) return { message: "Todavía no tenés publicaciones en Mercado Libre." };

  const items = listings.map(l => ({
    producto:        l.product_name,
    estado:          l.status === "paused" ? (ML_PAUSE_LABEL[l.pause_reason] || "Pausada") : (ML_STATUS_LABEL[l.status] || l.status),
    precio:          `$${fmt(l.price)}`,
    stock_disponible: l.available_stock,
    unidades_vendidas: l.units_sold || 0,
  }));

  return { total: items.length, publicaciones: items };
}

async function toolGetMyMlWallet(ctx) {
  const [balance, pendingDebt, blockedDebt, card, { plan_id }] = await Promise.all([
    mlWalletService.getBalance(ctx.sellerId),
    mlWalletService.getPendingDebt(ctx.sellerId),
    mlWalletService.getBlockedDebt(ctx.sellerId),
    mlWalletService.getCardStatus(ctx.sellerId),
    getSellerPlan(ctx.sellerId),
  ]);
  const graceHours = getPlanMlGraceHours(plan_id);

  return {
    plan:                plan_id,
    horas_de_gracia:     graceHours,
    saldo_disponible:    `$${fmt(balance)}`,
    deuda_pendiente_total: `$${fmt(pendingDebt)}`,
    deuda_obligatoria_vencida: `$${fmt(blockedDebt)}`,
    tarjeta_guardada:    card.hasCard ? `Terminada en ${card.lastFour}` : "No tiene",
    publicaciones_bloqueadas: Number(blockedDebt) > 0
      ? "Sí, tiene deuda vencida — publicaciones pausadas y pedidos sin despachar hasta que pague"
      : "No",
  };
}

async function toolGetSellerStats(ctx) {
  const { rows } = await pool.query(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'available' AND (available_at IS NULL OR available_at <= NOW()) THEN amount END), 0) AS balance_disponible,
      COALESCE(SUM(CASE WHEN status = 'available' AND available_at > NOW() THEN amount END), 0) AS balance_pendiente
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
        case "get_my_combos":
          result = await toolGetMyCombos(ctx);
          break;
        case "get_my_ml_listings":
          result = await toolGetMyMlListings(ctx);
          break;
        case "get_my_ml_wallet":
          result = await toolGetMyMlWallet(ctx);
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

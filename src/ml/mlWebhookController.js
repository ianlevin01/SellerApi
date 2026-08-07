import pool from "../database/db.js";
import * as repo from "./mlRepository.js";
import * as svc from "./mlService.js";
import { getValidToken } from "./mlTokenService.js";
import * as listingSvc from "./mlListingService.js";
import { getCotizacion } from "../payouts/payoutsRepository.js";
import { getSellerPlatformPct, calcShownCost } from "../utils/pricing.js";
import { getSellerPlan } from "../utils/sellerPlan.js";
import { sendMlSaleNotification, sendMlQuestionNotification, sendMlClaimNotification } from "../email/buyerEmails.js";
import { tryUseSellerStock, markItemSellerStock } from "../purchase/purchaseRepository.js";

const APP_ID = process.env.ML_CLIENT_ID;

// "Color: Rosa" a partir de variation_attributes — ML lo manda tanto para variantes clásicas
// (variation_id real) como para publicaciones "familia" (una por color, ver resolveUnmatchedItem
// más abajo), así que sirve para marcar la venta como variante en los dos casos.
function formatVariantLabel(variationAttributes) {
  if (!variationAttributes?.length) return null;
  return variationAttributes.map(a => `${a.name}: ${a.value_name}`).join(", ");
}

// Cuando ml_item_id no está en ml_listings (Mercado Libre migró una publicación con variantes
// internas a una "familia" de publicaciones nuevas, una por color/talle — ver conversación de
// diagnóstico del pedido #237) intenta reconectar automáticamente comparando el título real que
// tenía la publicación original contra el family_name que trae la nueva. Nunca adivina por el
// nombre interno del producto en Ventaz (puede no tener nada que ver con el título de ML) — si
// hay más de un candidato o ninguno, no asigna nada y deja que un admin lo haga a mano.
async function resolveUnmatchedItem(token, sellerId, mlItemId) {
  const mlItem = await svc.getItem(token, mlItemId).catch(() => null);
  if (!mlItem) return { mlItem: null, productId: null, matchMethod: null };

  const { rows: candidates } = await pool.query(
    `SELECT ml_item_id, product_id FROM ml_listings
     WHERE seller_id = $1 AND ml_combo_id IS NULL AND ml_item_id != $2
     ORDER BY updated_at DESC LIMIT 150`,
    [sellerId, mlItemId]
  );

  const matches = new Set();
  for (const c of candidates) {
    const candItem = await svc.getItem(token, c.ml_item_id).catch(() => null);
    if (!candItem) continue;
    const sameFamily = mlItem.family_id && candItem.family_id === mlItem.family_id;
    const titleMatchesFamilyName = mlItem.family_name && candItem.title === mlItem.family_name;
    if (sameFamily || titleMatchesFamilyName) matches.add(c.product_id);
  }

  if (matches.size === 1) {
    return { mlItem, productId: [...matches][0], matchMethod: "family_name" };
  }
  return { mlItem, productId: null, matchMethod: null };
}

// POST /seller/ml/webhook — ML no firma las notificaciones (a diferencia de MP), son un
// ping liviano; la seguridad real está en que hay que ir a buscar el recurso con un
// access_token válido, así que alcanza con validar que sea nuestra aplicación.
export async function handleWebhook(req, res) {
  res.status(200).json({ ok: true }); // responder rápido, ML reintenta si tarda

  const { topic, resource, user_id, application_id } = req.body || {};
  if (String(application_id) !== String(APP_ID)) {
    console.warn("[ml-webhook] application_id no coincide, ignorado");
    return;
  }

  const conn = await repo.getConnectionByMlUserId(user_id).catch(() => null);
  if (!conn) {
    console.warn(`[ml-webhook] no se encontró seller para ml_user_id=${user_id}`);
    return;
  }

  try {
    switch (topic) {
      case "orders_v2":  await handleOrder(conn, resource);   break;
      case "items":      await handleItem(conn, resource);    break;
      case "questions":  await handleQuestion(conn, resource); break;
      case "claims":     await handleClaim(conn, resource);   break;
      case "shipments":  /* solo tracking informativo — se resuelve con jobs/shippingTracker.js */ break;
      case "public_offers": /* ofertas relámpago — TODO fase 2 */ break;
      default: break;
    }
  } catch (err) {
    console.error(`[ml-webhook] error procesando topic=${topic}:`, err.message);
  }
}

async function handleOrder(conn, resourcePath) {
  const orderId = resourcePath.split("/").pop();
  const token = await getValidToken(conn.seller_id);
  if (!token) return;

  const order = await svc.getOrder(token, orderId);
  if (!order?.id) return;
  await processOrder(conn, order);
}

// Todo lo que pasa una vez que ya tenemos el `order` de ML (venga de svc.getOrder en el webhook
// real, o de un pedido sintético armado a mano para probar el flujo sin una venta real — ver
// scripts/simulateMlSale.mjs). Separado de handleOrder() para que el script de prueba pueda
// ejercitar exactamente esta misma lógica sin necesitar golpear la API de ML.
export async function processOrder(conn, order) {
  // "Reclamamos" el pedido con un INSERT atómico ANTES de tocar nada más (reservas de stock,
  // cálculo de costo, mail) — ML puede mandar la notificación de una misma venta más de una vez
  // casi al mismo tiempo (reintento, o dos eventos del mismo pedido), y un SELECT-y-después-
  // INSERT no es atómico: dos notificaciones casi simultáneas pueden pasar el SELECT antes de
  // que ninguna haya insertado todavía, duplicando la deuda (y, peor, descontando la reserva de
  // stock del vendedor dos veces). El UNIQUE en ml_order_id + ON CONFLICT hace que solo una de
  // las dos gane la carrera; la otra corta acá mismo sin efectos secundarios.
  const { rows: claimed } = await pool.query(
    `INSERT INTO web_orders
       (numero, seller_id, channel, order_type, ml_order_id, ml_charge_status, color, total)
     VALUES (
       (SELECT COALESCE(MAX(numero), 0) + 1 FROM web_orders WHERE seller_id = $1),
       $1, 'mercadolibre', 'stock_reserve', $2, 'pending', 'paid', 0)
     ON CONFLICT (ml_order_id) DO NOTHING
     RETURNING id`,
    [conn.seller_id, String(order.id)]
  );
  if (!claimed[0]) return; // ya procesado (o procesándose en este mismo instante) por otra notificación
  const webOrderId = claimed[0].id;

  // Necesario acá (no solo en handleOrder) para resolver ítems sin match y para consultar el
  // shipment más abajo — se re-pide en vez de recibirlo como parámetro porque processOrder()
  // también se llama directo desde scripts/simulateMlSale.mjs con un pedido armado a mano.
  const token = await getValidToken(conn.seller_id);

  const cotizacion = await getCotizacion();
  const totalSalesArs = 0; // TODO: ver si conviene usar ventas históricas del seller para el tier de platformPct
  const platformPct = getSellerPlatformPct(totalSalesArs);
  const { plan_id: planId } = await getSellerPlan(conn.seller_id);

  let costTotal = 0;
  const items = [];
  for (const item of order.order_items || []) {
    const variantLabel = formatVariantLabel(item.item.variation_attributes);
    const { rows: listingRows } = await pool.query(
      `SELECT product_id, ml_combo_id, permalink FROM ml_listings WHERE ml_item_id = $1`,
      [item.item.id]
    );
    let listing = listingRows[0];
    let permalink = listing?.permalink || null;
    let matchMethod = null;

    if (!listing) {
      const resolved = await resolveUnmatchedItem(token, conn.seller_id, item.item.id).catch(() => ({ mlItem: null, productId: null, matchMethod: null }));
      permalink = resolved.mlItem?.permalink || null;
      if (resolved.productId) {
        listing = { product_id: resolved.productId, ml_combo_id: null };
        matchMethod = resolved.matchMethod;
        // Recuerda la publicación nueva para que la próxima venta de este mismo ml_item_id
        // (o cualquier otra que ya haya pasado por acá) resuelva directo, sin repetir el
        // escaneo de candidatos contra la API de ML.
        await repo.createListing(conn.seller_id, {
          productId: resolved.productId, mlItemId: item.item.id, status: "active", permalink,
        }).catch(() => {});
      } else {
        // No se pudo reconectar con ningún producto — se guarda igual como "sin asignar"
        // (product_id null, sin costo/deuda) con el link a la publicación real y la variante,
        // para que un admin lo asigne a mano desde AdminPanel y ahí sí se genere la deuda.
        items.push({
          productId: null, name: resolved.mlItem?.title || item.item.title,
          quantity: item.quantity, unitPrice: item.unit_price, sellerStockUsed: 0,
          mlItemId: item.item.id, variantLabel, permalink, matchMethod: null,
        });
        continue;
      }
    }

    if (listing.ml_combo_id) {
      // Un combo vendido se reparte en varias filas de web_order_items (una por producto que
      // lo compone) — necesario para que el stock/costo se compute por producto, igual que
      // si se hubieran vendido sueltos. El precio unitario del combo se reparte proporcional
      // al costo de cada producto, solo para que el detalle del pedido tenga sentido.
      const { rows: comboProducts } = await pool.query(
        `SELECT cp.product_id, cp.quantity, p.name, p.costo_usd
         FROM ml_combo_products cp JOIN products p ON p.id = cp.product_id
         WHERE cp.ml_combo_id = $1`,
        [listing.ml_combo_id]
      );
      const comboUnitCost = comboProducts.reduce((sum, cp) => sum + calcShownCost(cp.costo_usd, cotizacion, platformPct, planId) * cp.quantity, 0);
      for (const cp of comboProducts) {
        const qty = cp.quantity * item.quantity;
        const productUnitCost = calcShownCost(cp.costo_usd, cotizacion, platformPct, planId);
        // Las unidades que salen de stock reservado por el vendedor (ya pagado antes, ver
        // sellerCheckoutService.reserveStockCheckout) no generan deuda de nuevo — mismo
        // criterio que ya usa purchaseService para ventas de la tienda propia.
        const reserveUsed = await tryUseSellerStock(conn.seller_id, cp.product_id, qty);
        const chargeableQty = qty - reserveUsed;
        costTotal += productUnitCost * chargeableQty;
        const share = comboUnitCost > 0 ? (productUnitCost * cp.quantity) / comboUnitCost : 0;
        const unitPrice = qty > 0 ? (item.unit_price * item.quantity * share) / qty : 0;
        items.push({
          productId: cp.product_id, name: cp.name, quantity: qty, unitPrice, sellerStockUsed: reserveUsed,
          mlItemId: item.item.id, variantLabel, permalink, matchMethod,
        });
      }
    } else {
      const { rows } = await pool.query(
        `SELECT id AS product_id, name, costo_usd FROM products WHERE id = $1`,
        [listing.product_id]
      );
      const product = rows[0];
      if (!product) continue;
      const unitCost = calcShownCost(product.costo_usd, cotizacion, platformPct, planId);
      const reserveUsed = await tryUseSellerStock(conn.seller_id, product.product_id, item.quantity);
      const chargeableQty = item.quantity - reserveUsed;
      costTotal += unitCost * chargeableQty;
      items.push({
        productId: product.product_id, name: product.name, quantity: item.quantity, unitPrice: item.unit_price, sellerStockUsed: reserveUsed,
        mlItemId: item.item.id, variantLabel, permalink, matchMethod,
      });
    }
  }

  // logistic_type real del envío (self_service = Flex, drop_off/xd_drop_off/cross_docking =
  // Correo) — se guarda acá en vez de pedirlo recién al imprimir etiquetas, para que AdminPanel
  // pueda separar Correo/Flex sin pegarle a la API de ML en cada carga del panel.
  let logisticType = null;
  if (order.shipping?.id) {
    const shipment = await svc.getShipment(token, order.shipping.id).catch(() => null);
    logisticType = shipment?.logistic_type || null;
  }

  const buyer = order.buyer || {};
  const { rows: updated } = await pool.query(
    `UPDATE web_orders
     SET customer_name = $2, customer_email = $3, customer_phone = $4, total = $5,
         ml_shipment_id = $6, ml_cost_amount = $7, ml_logistic_type = $8
     WHERE id = $1
     RETURNING numero`,
    [webOrderId, buyer.nickname || buyer.first_name || "Comprador ML", buyer.email || null,
     buyer.phone?.number || null, order.total_amount,
     order.shipping?.id ? String(order.shipping.id) : null, costTotal, logisticType]
  );

  for (const item of items) {
    await pool.query(
      `INSERT INTO web_order_items
         (web_order_id, product_id, name, quantity, unit_price, ml_item_id, ml_variant_label, ml_permalink, ml_match_method)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [webOrderId, item.productId, item.name, item.quantity, item.unitPrice,
       item.mlItemId || null, item.variantLabel || null, item.permalink || null, item.matchMethod || null]
    );
    if (item.sellerStockUsed > 0) {
      await markItemSellerStock(webOrderId, item.productId, item.sellerStockUsed);
    }
  }

  const sellerEmail = await pool.query(`SELECT email FROM sellers WHERE id = $1`, [conn.seller_id])
    .then(r => r.rows[0]?.email);
  if (sellerEmail) {
    sendMlSaleNotification(sellerEmail, { numero: updated[0].numero, total: order.total_amount }).catch(() => {});
  }
}

async function handleItem(conn, resourcePath) {
  const itemId = resourcePath.split("/").pop();
  const token = await getValidToken(conn.seller_id);
  if (!token) return;
  const item = await svc.getItem(token, itemId).catch(() => null);
  if (!item) return;
  await repo.updateListingStatus(itemId, item.status).catch(() => {});
}

async function handleQuestion(conn, resourcePath) {
  const questionId = resourcePath.split("/").pop();
  const token = await getValidToken(conn.seller_id);
  if (!token) return;
  const q = await svc.getQuestion(token, questionId).catch(() => null);
  const sellerEmail = await pool.query(`SELECT email FROM sellers WHERE id = $1`, [conn.seller_id])
    .then(r => r.rows[0]?.email);
  if (sellerEmail) {
    sendMlQuestionNotification(sellerEmail, {
      itemTitle: q?.item_id, questionText: q?.text || "(no se pudo obtener el detalle)",
    }).catch(() => {});
  }
}

async function handleClaim(conn) {
  const sellerEmail = await pool.query(`SELECT email FROM sellers WHERE id = $1`, [conn.seller_id])
    .then(r => r.rows[0]?.email);
  if (sellerEmail) {
    sendMlClaimNotification(sellerEmail, {}).catch(() => {});
  }
}

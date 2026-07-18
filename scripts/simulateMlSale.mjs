/**
 * simulateMlSale.mjs — simula que llega una venta de Mercado Libre para probar todo el flujo
 * interno (deuda, reserva de stock, envío del mail al vendedor) SIN necesitar una compra real.
 *
 * Arma un pedido "order" con la misma forma que devuelve la API de Mercado Libre y lo procesa
 * con mlWebhookController.processOrder() — literalmente la misma función que corre en
 * producción cuando llega el webhook real, salvo por el primer paso (svc.getOrder(), que sí
 * pega contra la API de ML) que acá se reemplaza por este objeto armado a mano. Todo lo que
 * pasa después (cálculo de costo, chequeo de reserva de stock, inserción en web_orders/
 * web_order_items, mail al vendedor) es exactamente el código real.
 *
 * NO simula ni puede simular:
 *   - Que la notificación llegue de verdad desde Mercado Libre (requiere token válido +
 *     tópicos bien suscriptos — eso solo se prueba con una venta real o el simulador propio
 *     de ML en su DevCenter).
 *   - Las etiquetas de envío — no existe un shipment_id real en Mercado Libre, así que
 *     AdminPanel no va a poder traer el PDF para este pedido (esperado, no es un bug).
 *
 * Uso:
 *   node scripts/simulateMlSale.mjs vendedor@email.com
 *   node scripts/simulateMlSale.mjs vendedor@email.com --item MLA123456789
 *   node scripts/simulateMlSale.mjs vendedor@email.com --qty 2
 */
import "dotenv/config";
import pool from "../src/database/db.js";
import { processOrder } from "../src/ml/mlWebhookController.js";

function parseArgs(argv) {
  const [email, ...rest] = argv;
  const opts = { email, item: null, qty: 1 };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--item") opts.item = rest[++i];
    if (rest[i] === "--qty")  opts.qty  = Math.max(1, parseInt(rest[++i], 10) || 1);
  }
  return opts;
}

async function main() {
  const { email, item, qty } = parseArgs(process.argv.slice(2));
  if (!email) {
    console.error("Uso: node scripts/simulateMlSale.mjs <email-del-vendedor> [--item MLA...] [--qty N]");
    process.exit(1);
  }

  const { rows: sellerRows } = await pool.query(`SELECT id, email, name FROM sellers WHERE email = $1`, [email]);
  const seller = sellerRows[0];
  if (!seller) { console.error(`No se encontró ningún vendedor con email ${email}`); process.exit(1); }
  console.log(`Vendedor: ${seller.name} (${seller.email})`);

  let listing;
  if (item) {
    const { rows } = await pool.query(
      `SELECT ml_item_id, product_id, ml_combo_id, price, status
       FROM ml_listings WHERE ml_item_id = $1 AND seller_id = $2`,
      [item, seller.id]
    );
    listing = rows[0];
    if (!listing) { console.error(`La publicación ${item} no existe o no es de este vendedor`); process.exit(1); }
  } else {
    const { rows } = await pool.query(
      `SELECT ml_item_id, product_id, ml_combo_id, price, status
       FROM ml_listings WHERE seller_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
      [seller.id]
    );
    listing = rows[0];
    if (!listing) { console.error("Este vendedor no tiene ninguna publicación activa en Mercado Libre para simular una venta"); process.exit(1); }
  }

  const label = listing.ml_combo_id ? "combo" : "producto";
  console.log(`Publicación elegida: ${listing.ml_item_id} (${label}), precio $${listing.price}, cantidad simulada: ${qty}`);

  if (listing.product_id) {
    const { rows: reserve } = await pool.query(
      `SELECT quantity FROM seller_stock_reserves WHERE seller_id = $1 AND product_id = $2`,
      [seller.id, listing.product_id]
    );
    console.log(`Reserva de stock propia para ese producto: ${reserve[0]?.quantity ?? 0} unidades`
      + (reserve[0]?.quantity > 0 ? " — se va a descontar de ahí en vez de generar deuda" : " — la venta va a generar deuda completa"));
  }

  const fakeOrderId = `SIM-${Date.now()}`;
  const unitPrice = Number(listing.price) || 10000;
  const order = {
    id: fakeOrderId,
    total_amount: unitPrice * qty,
    order_items: [{ item: { id: listing.ml_item_id }, quantity: qty, unit_price: unitPrice }],
    buyer: { nickname: "Comprador de prueba", email: null, phone: { number: null } },
    shipping: { id: `SIM-SHIP-${Date.now()}` }, // fake — no existe en ML, las etiquetas no van a poder traerse para este pedido
  };

  const conn = { seller_id: seller.id };
  await processOrder(conn, order);

  const { rows: inserted } = await pool.query(
    `SELECT id, numero, total, ml_cost_amount, ml_charge_status, color, ml_shipment_id
     FROM web_orders WHERE ml_order_id = $1`,
    [fakeOrderId]
  );
  const webOrder = inserted[0];
  if (!webOrder) { console.error("processOrder() no insertó ningún pedido — revisá que el ml_item_id tenga un producto/combo válido asociado."); process.exit(1); }

  const { rows: items } = await pool.query(
    `SELECT product_id, name, quantity, unit_price, seller_stock_used FROM web_order_items WHERE web_order_id = $1`,
    [webOrder.id]
  );

  console.log("\n✅ Pedido simulado registrado en Ventaz:");
  console.log(`   numero: ${webOrder.numero}  |  total: $${webOrder.total}`);
  console.log(`   ml_cost_amount (deuda generada): $${webOrder.ml_cost_amount}  |  ml_charge_status: ${webOrder.ml_charge_status}`);
  console.log("   Items:");
  for (const it of items) {
    console.log(`     - ${it.name} x${it.quantity} — $${it.unit_price} c/u` + (it.seller_stock_used > 0 ? ` (${it.seller_stock_used} salieron de tu reserva propia, no generan deuda)` : ""));
  }
  console.log("\nProbá ahora en SellerSystem → Mercado Libre → Cobro: debería verse esta deuda nueva.");
  console.log("Para probar el cobro sin esperar al corte diario, usá el botón 'Pagar deuda ahora' ahí mismo.");
  console.log("Las etiquetas de este pedido puntual NO van a poder traerse desde AdminPanel — el shipment_id es inventado, no existe en Mercado Libre.");

  await pool.end();
}

main().catch(err => { console.error("Error:", err); process.exit(1); });

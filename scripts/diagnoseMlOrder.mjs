/**
 * diagnoseMlOrder.mjs — trae, para un pedido de Mercado Libre ya guardado en Ventaz, tanto lo
 * que tenemos en nuestra base (web_orders/web_order_items) como el pedido y el ítem tal cual
 * los devuelve la API real de Mercado Libre en este momento — sin tocar nada, solo lectura.
 * Pensado para diagnosticar por qué un pedido con "variantes" (color, talle, etc.) puede llegar
 * sin producto asignado y sin deuda generada, y para confirmar el logistic_type real del envío
 * (Correo vs Flex).
 *
 * Además, si el ítem vendido tiene family_id (Mercado Libre agrupa así las publicaciones
 * hermanas por color/talle, cada una con su propio ml_item_id), busca en products + ml_listings
 * del mismo vendedor candidatos por nombre parecido y compara su family_id contra el del ítem
 * vendido — para confirmar si hay una forma confiable de reconectar sin adivinar por texto.
 *
 * Uso:
 *   node scripts/diagnoseMlOrder.mjs vendedor@email.com <numero_de_pedido_en_ventaz>
 */
import "dotenv/config";
import pool from "../src/database/db.js";
import * as svc from "../src/ml/mlService.js";
import { getValidToken } from "../src/ml/mlTokenService.js";

async function main() {
  const [email, numero] = process.argv.slice(2);
  if (!email || !numero) {
    console.error("Uso: node scripts/diagnoseMlOrder.mjs vendedor@email.com <numero_de_pedido>");
    process.exit(1);
  }

  const { rows: sellerRows } = await pool.query(`SELECT id, name, email FROM sellers WHERE email = $1`, [email]);
  const seller = sellerRows[0];
  if (!seller) { console.error(`No se encontró un seller con email ${email}`); process.exit(1); }

  const { rows: orderRows } = await pool.query(
    `SELECT * FROM web_orders WHERE seller_id = $1 AND numero = $2 AND channel = 'mercadolibre'`,
    [seller.id, numero]
  );
  const order = orderRows[0];
  if (!order) { console.error(`No se encontró el pedido #${numero} de ML para ese seller`); process.exit(1); }
  console.log(`\n=== web_orders (Ventaz) — total=${order.total}, ml_cost_amount=${order.ml_cost_amount} ===`);

  const { rows: items } = await pool.query(`SELECT product_id, name, quantity, unit_price FROM web_order_items WHERE web_order_id = $1`, [order.id]);
  console.log(`=== web_order_items (Ventaz) — ${items.length} fila(s) ===`);
  console.log(items);

  const token = await getValidToken(seller.id);
  if (!token) { console.error("El vendedor no tiene token de ML válido — no se puede consultar la API"); process.exit(1); }

  const mlOrder = await svc.getOrder(token, order.ml_order_id);

  for (const oi of mlOrder.order_items || []) {
    console.log(`\n--- Ítem vendido: ${oi.item.id} — "${oi.item.title}" ---`);
    console.log(`variation_id: ${oi.item.variation_id}`);
    console.log(`variation_attributes: ${JSON.stringify(oi.item.variation_attributes)}`);

    const { rows: directMatch } = await pool.query(`SELECT product_id FROM ml_listings WHERE ml_item_id = $1`, [oi.item.id]);
    console.log(`Match directo en ml_listings por ml_item_id: ${directMatch[0] ? directMatch[0].product_id : "NINGUNO"}`);

    const mlItem = await svc.getItem(token, oi.item.id).catch(err => ({ error: err.message }));
    console.log(`family_id: ${mlItem.family_id ?? "(sin family_id)"}  family_name: "${mlItem.family_name ?? ""}"`);

    if (mlItem.family_id) {
      // Barre TODAS las publicaciones que Ventaz registró para este vendedor (cualquier status)
      // y compara su family_id contra el del ítem vendido — no filtra por nombre porque el
      // nombre del producto en el catálogo de Ventaz puede no coincidir textualmente con el
      // título que tiene la publicación en ML.
      const { rows: allListings } = await pool.query(
        `SELECT ml.ml_item_id, ml.product_id, ml.status, p.name
         FROM ml_listings ml JOIN products p ON p.id = ml.product_id
         WHERE ml.seller_id = $1`,
        [seller.id]
      );
      console.log(`Comparando family_id contra las ${allListings.length} publicaciones registradas de este vendedor...`);
      for (const c of allListings) {
        if (c.ml_item_id === oi.item.id) continue;
        const candItem = await svc.getItem(token, c.ml_item_id).catch(() => null);
        if (candItem?.family_id === mlItem.family_id) {
          console.log(`  ★★★ MATCH DE FAMILY_ID ★★★ product_id=${c.product_id} name="${c.name}" ml_item_id=${c.ml_item_id} status=${c.status}`);
        }
      }
    }
  }

  if (mlOrder.shipping?.id) {
    const shipment = await svc.getShipment(token, mlOrder.shipping.id).catch(err => ({ error: err.message }));
    console.log(`\nshipment.mode: ${shipment?.mode}  shipment.logistic_type: ${shipment?.logistic_type}`);
  } else {
    console.log(`\nEste pedido no tiene shipping.id en la respuesta de ML.`);
  }
}

main().then(() => process.exit(0)).catch(err => { console.error("Error:", err); process.exit(1); });

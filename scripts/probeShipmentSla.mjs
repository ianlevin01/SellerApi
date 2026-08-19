/**
 * probeShipmentSla.mjs — trae la respuesta real de GET /shipments/{id}/sla para un pedido de
 * ML puntual, para confirmar qué campo trae la fecha/hora límite de despacho (varía por día y
 * por zona, la define Mercado Libre — no es algo que Ventaz pueda calcular por su cuenta). Solo
 * lectura, no modifica nada.
 *
 * Uso:
 *   node scripts/probeShipmentSla.mjs vendedor@email.com <numero_de_pedido_en_ventaz>
 */
import "dotenv/config";
import pool from "../src/database/db.js";
import { getValidToken } from "../src/ml/mlTokenService.js";

const API_BASE = "https://api.mercadolibre.com";

async function main() {
  const [email, numero] = process.argv.slice(2);
  if (!email || !numero) {
    console.error("Uso: node scripts/probeShipmentSla.mjs vendedor@email.com <numero_de_pedido>");
    process.exit(1);
  }

  const { rows: sellerRows } = await pool.query(`SELECT id FROM sellers WHERE email = $1`, [email]);
  const seller = sellerRows[0];
  if (!seller) { console.error(`No se encontró un seller con email ${email}`); process.exit(1); }

  const { rows: orderRows } = await pool.query(
    `SELECT ml_shipment_id, ml_logistic_type, created_at FROM web_orders WHERE seller_id = $1 AND numero = $2 AND channel = 'mercadolibre'`,
    [seller.id, numero]
  );
  const order = orderRows[0];
  if (!order?.ml_shipment_id) { console.error(`No se encontró el pedido #${numero} o no tiene shipment_id`); process.exit(1); }
  console.log(`shipment_id: ${order.ml_shipment_id}  logistic_type: ${order.ml_logistic_type}  created_at: ${order.created_at}`);

  const token = await getValidToken(seller.id);
  if (!token) { console.error("El vendedor no tiene token de ML válido"); process.exit(1); }

  console.log(`\n=== GET /shipments/${order.ml_shipment_id}/sla ===`);
  const slaRes = await fetch(`${API_BASE}/shipments/${order.ml_shipment_id}/sla`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const slaData = await slaRes.json().catch(() => null);
  console.log(`status HTTP: ${slaRes.status}`);
  console.log(JSON.stringify(slaData, null, 2));

  console.log(`\n=== GET /shipments/${order.ml_shipment_id} (para comparar contra la data completa) ===`);
  const shipRes = await fetch(`${API_BASE}/shipments/${order.ml_shipment_id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const shipData = await shipRes.json().catch(() => null);
  console.log(`status HTTP: ${shipRes.status}`);
  console.log(`status: ${shipData?.status}  substatus: ${shipData?.substatus}`);
  console.log("substatus_history:", JSON.stringify(shipData?.substatus_history, null, 2));
  console.log("status_history:", JSON.stringify(shipData?.status_history, null, 2));
  console.log("shipping_option:", JSON.stringify(shipData?.shipping_option, null, 2));
}

main().then(() => process.exit(0)).catch(err => { console.error("Error:", err); process.exit(1); });

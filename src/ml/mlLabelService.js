import { PDFDocument } from "pdf-lib";
import pool from "../database/db.js";
import { getValidToken } from "./mlTokenService.js";
import * as svc from "./mlService.js";
import * as walletRepo from "./mlWalletRepository.js";
import { getSellerPlan, getPlanMlGraceHours } from "../utils/sellerPlan.js";

// Junta las etiquetas de envío de varios pedidos de ML (de distintos vendedores, cada uno
// con su propio token) en un solo PDF combinado para que el equipo de despacho lo imprima
// de una — Ventaz despacha todas las ventas de ML de forma centralizada, sin importar el
// vendedor dueño de la publicación.
//
// El bloqueo es por CUENTA, no por pedido puntual: si el vendedor tiene ALGUNA deuda que ya
// superó su ventana de gracia sin pagarse, se bloquean TODOS sus pedidos pendientes (incluso
// los de ventas recientes que todavía están dentro de su propia ventana) — mismo criterio que
// usa el pausado de publicaciones (pausa todas, no solo la de la venta que falló). force=true
// salta este chequeo (el admin decide imprimir igual desde la pestaña "Pendientes de pago").
export async function getLabelsPdfForOrders(orderIds, { force = false } = {}) {
  const { rows } = await pool.query(
    `SELECT id, seller_id, ml_order_id, ml_shipment_id, ml_charge_status, created_at FROM web_orders
     WHERE id = ANY($1::uuid[]) AND channel = 'mercadolibre'`,
    [orderIds]
  );
  if (rows.length === 0) {
    const e = new Error("No hay pedidos de Mercado Libre para esos ids");
    e.status = 400;
    throw e;
  }

  const bySeller = new Map();
  for (const row of rows) {
    if (!bySeller.has(row.seller_id)) bySeller.set(row.seller_id, []);
    bySeller.get(row.seller_id).push(row);
  }

  const merged = await PDFDocument.create();
  const errors = [];

  for (const [sellerId, allOrders] of bySeller) {
    const token = await getValidToken(sellerId);
    if (!token) { errors.push(`Un vendedor no tiene conexión activa a Mercado Libre — sus etiquetas no se incluyeron`); continue; }

    let orders = allOrders;
    if (!force) {
      const { plan_id } = await getSellerPlan(sellerId);
      const graceHours  = getPlanMlGraceHours(plan_id);
      const blockedDebt = await walletRepo.getBlockedDebt(sellerId, graceHours);
      if (blockedDebt > 0) {
        orders = allOrders.filter(o => o.ml_charge_status === "charged");
        const blockedCount = allOrders.length - orders.length;
        if (blockedCount > 0) {
          errors.push(`${blockedCount} pedido(s) bloqueados — el vendedor tiene deuda vencida sin pagar`);
        }
      }
    }
    if (orders.length === 0) continue;

    // Pedidos guardados antes de que empezáramos a registrar ml_shipment_id — lo
    // completamos ahora consultando la orden en vivo, y lo dejamos guardado para la próxima.
    const shipmentIds = [];
    for (const order of orders) {
      let shipmentId = order.ml_shipment_id;
      if (!shipmentId) {
        const mlOrder = await svc.getOrder(token, order.ml_order_id).catch(() => null);
        shipmentId = mlOrder?.shipping?.id ? String(mlOrder.shipping.id) : null;
        if (shipmentId) {
          await pool.query(`UPDATE web_orders SET ml_shipment_id = $1 WHERE id = $2`, [shipmentId, order.id]);
        }
      }
      if (shipmentId) shipmentIds.push(shipmentId);
    }
    if (shipmentIds.length === 0) continue;

    // Un mismo shipment puede venir de más de un pedido de Ventaz (ML agrupa varios pedidos
    // del mismo vendedor en un solo envío/etiqueta) — sin este dedup, pedirle el mismo
    // shipment_id dos veces a ML duplica la página de esa etiqueta en el PDF final.
    const uniqueShipmentIds = [...new Set(shipmentIds)];

    // Máximo 50 shipment_ids por request — límite propio de la API de ML.
    for (let i = 0; i < uniqueShipmentIds.length; i += 50) {
      const batch = uniqueShipmentIds.slice(i, i + 50);
      try {
        const pdfBuffer = await svc.getShipmentLabelsPdf(token, batch);
        const doc = await PDFDocument.load(pdfBuffer);
        const copiedPages = await merged.copyPages(doc, doc.getPageIndices());
        copiedPages.forEach(p => merged.addPage(p));
      } catch (err) {
        errors.push(err.message);
      }
    }
  }

  if (merged.getPageCount() === 0) {
    const e = new Error(errors.join(" | ") || "No se pudo generar ninguna etiqueta");
    e.status = 502;
    throw e;
  }

  const pdfBytes = await merged.save();
  return { buffer: Buffer.from(pdfBytes), errors };
}

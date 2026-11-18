// Resumen diario de despacho — HARDCODEADO a propósito para UNA sola cuenta (yolodercye@gmail.com).
//
// Todos los días a las 09:00 hora de Argentina le manda por mail a ese vendedor la lista de
// productos que tienen que salir HOY del depósito: nombre + código + cantidad total, sumando
// todos los pedidos de Mercado Libre cuyo despacho vence hoy y todavía no salieron. No lista las
// ventas una por una — solo el total por producto.
//
// Qué entra, con el mismo criterio que la pestaña "Pendiente de hoy" del AdminPanel (ver
// adminService.getMlSales): fecha límite de despacho (ml_dispatch_expected_date, día calendario
// ART) igual a hoy y pedido sin despachar. A diferencia de allá, los envíos cancelados no entran:
// hay muchos con ml_dispatched_at en null que nunca van a salir. Los atrasados (fecha límite ya
// vencida y sin despachar) NO se incluyen: este mail es solo lo que vence hoy.
//
// Antes de armar la lista se completan las fechas que falten y se refresca el estado de cada
// envío contra la API de Mercado Libre (igual que hace el AdminPanel al listar): el webhook puede
// llegar antes de que ML asigne la fecha límite, y sin esto un pedido de esta mañana quedaría
// afuera, o uno ya despachado/cancelado adentro.
import pool from "../database/db.js";
import { transporter } from "../config/mailer.js";
import { baseLayout } from "../email/buyerEmails.js";
import * as mlSvc from "../ml/mlService.js";
import { getValidToken } from "../ml/mlTokenService.js";
import * as adminRepo from "../admin/adminRepository.js";

const SELLER_EMAIL   = "yolodercye@gmail.com";
const HORA_ENVIO_UTC = 12;                      // 09:00 ART (UTC-3, Argentina no tiene horario de verano)
const TZ             = "America/Argentina/Buenos_Aires";
const CONCURRENCY    = 5;                       // llamadas en paralelo a la API de ML

// Estados de envío que ya no van a salir del depósito (o ya salieron).
const SHIPMENT_STATUS_DONE = new Set(["cancelled", "shipped", "delivered", "not_delivered", "returned"]);

const argDay = (date) => (date ? new Date(date).toLocaleDateString("en-CA", { timeZone: TZ }) : null);

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function mapWithConcurrency(items, concurrency, fn) {
  for (let i = 0; i < items.length; i += concurrency) {
    await Promise.all(items.slice(i, i + concurrency).map(fn));
  }
}

// Pedidos de ML todavía sin despachar y con un envío que no esté cancelado/terminado. Se mira
// solo el último mes: más viejo que eso ya no puede ser un pedido a despachar hoy.
async function getCandidateOrders(sellerId) {
  const { rows } = await pool.query(
    `SELECT wo.id, wo.ml_order_id, wo.ml_shipment_id, wo.ml_logistic_type,
            wo.ml_dispatch_expected_date, wo.ml_dispatched_at,
            wo.ml_shipment_status, wo.ml_shipment_substatus
     FROM web_orders wo
     WHERE wo.seller_id = $1 AND wo.channel = 'mercadolibre'
       AND wo.color IN ('paid', 'packaged')
       AND wo.ml_dispatched_at IS NULL
       AND wo.ml_shipment_id IS NOT NULL
       AND (wo.ml_shipment_status IS NULL OR wo.ml_shipment_status <> ALL($2::text[]))
       AND wo.created_at >= now() - interval '30 days'`,
    [sellerId, [...SHIPMENT_STATUS_DONE]]
  );
  return rows;
}

// Completa la fecha límite/logística que falte y refresca el estado real de cada envío — deja
// las filas actualizadas (y guardadas) para que el filtro de abajo decida con datos al día.
async function completeAndRefresh(sellerId, rows) {
  const token = await getValidToken(sellerId).catch(() => null);
  if (!token) {
    console.warn("[dispatch-summary] sin token de ML: se arma la lista con lo que ya hay guardado");
    return;
  }

  await mapWithConcurrency(rows, CONCURRENCY, async row => {
    try {
      const shipment = await mlSvc.getShipment(token, row.ml_shipment_id).catch(() => null);
      if (shipment) {
        const dispatched = mlSvc.isShipmentDispatched(shipment);
        row.ml_shipment_status    = shipment.status || null;
        row.ml_shipment_substatus = shipment.substatus || null;
        if (dispatched) row.ml_dispatched_at = new Date().toISOString();
        if (!row.ml_logistic_type && shipment.logistic_type) {
          row.ml_logistic_type = shipment.logistic_type;
          await adminRepo.setOrderLogisticType(row.id, shipment.logistic_type);
        }
        await adminRepo.setOrderShipmentStatus(row.id, {
          status: row.ml_shipment_status, substatus: row.ml_shipment_substatus,
          dateShipped: shipment.status_history?.date_shipped || null, dispatched,
        });
      }

      if (!row.ml_dispatch_expected_date) {
        const sla = await mlSvc.getShipmentSla(token, row.ml_shipment_id).catch(() => null);
        if (sla?.expected_date) {
          row.ml_dispatch_expected_date = sla.expected_date;
          await adminRepo.setOrderDispatchSla(row.id, { expectedDate: sla.expected_date, slaStatus: sla.status || null });
        }
      }
    } catch (err) {
      console.error(`[dispatch-summary] no se pudo actualizar el envío del pedido ${row.ml_order_id}:`, err.message);
    }
  });
}

// ¿Este pedido todavía tiene que salir del depósito? (después de refrescar)
function stillToShip(row) {
  if (row.ml_dispatched_at) return false;
  if (SHIPMENT_STATUS_DONE.has(row.ml_shipment_status)) return false;
  if (row.ml_shipment_substatus === "fraudulent") return false; // ML lo frenó: no se despacha
  return true;
}

// Total por producto de un conjunto de pedidos: código, nombre y cantidad. Un producto sin
// vincular (item que nunca se asignó a uno de Ventaz) se agrupa por el título de la publicación.
async function totalsByProduct(orderIds) {
  if (orderIds.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT COALESCE(p.code, NULLIF(woi.code, ''), '—') AS code,
            COALESCE(p.name, woi.name)                  AS name,
            SUM(woi.quantity)::int                      AS quantity
     FROM web_order_items woi
     LEFT JOIN products p ON p.id = woi.product_id
     WHERE woi.web_order_id = ANY($1::uuid[])
     GROUP BY COALESCE(p.id::text, woi.name), p.code, woi.code, p.name, woi.name
     ORDER BY SUM(woi.quantity) DESC, COALESCE(p.name, woi.name)`,
    [orderIds]
  );
  return rows;
}

function tableHtml(items) {
  const th = "padding:8px 10px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;border-bottom:2px solid #e5e7eb";
  const td = "padding:9px 10px;font-size:14px;color:#111827;border-bottom:1px solid #f1f5f9";
  const rows = items.map(i => `
    <tr>
      <td style="${td}">${esc(i.name)}</td>
      <td style="${td};white-space:nowrap;color:#4b5563">${esc(i.code)}</td>
      <td style="${td};text-align:right;font-weight:700;white-space:nowrap">${i.quantity}</td>
    </tr>`).join("");
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 8px">
      <tr><th style="${th}">Producto</th><th style="${th}">Código</th><th style="${th};text-align:right">Cantidad</th></tr>
      ${rows}
    </table>`;
}

const sum = (items) => items.reduce((s, i) => s + i.quantity, 0);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function buildEmail({ today, hoy, sinFecha }) {
  const [y, m, d] = today.split("-");
  const fecha = `${d}/${m}`;
  const unidadesHoy = sum(hoy.items);

  const subject = hoy.items.length
    ? `Despacho de hoy ${fecha}: ${plural(unidadesHoy, "unidad", "unidades")} en ${plural(hoy.items.length, "producto", "productos")}`
    : `Despacho de hoy ${fecha}: no hay pedidos para despachar`;

  let body = `
    <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#3a9a15;letter-spacing:.03em;text-transform:uppercase">Despacho del día</p>
    <h2 style="margin:0 0 18px;font-size:22px;font-weight:700;color:#111827">${d}/${m}/${y}</h2>`;

  if (hoy.items.length) {
    body += `
      <p style="margin:0 0 14px;font-size:15px;color:#4b5563;line-height:1.6">
        Hoy tienen que salir del depósito <strong>${plural(unidadesHoy, "unidad", "unidades")}</strong>
        de <strong>${plural(hoy.items.length, "producto", "productos")}</strong>
        (${plural(hoy.orders, "pedido", "pedidos")} de Mercado Libre con despacho para hoy, hasta este momento).
      </p>${tableHtml(hoy.items)}`;
  } else {
    body += `<p style="margin:0 0 14px;font-size:15px;color:#4b5563;line-height:1.6">Hasta este momento no hay pedidos de Mercado Libre con despacho para hoy.</p>`;
  }

  if (sinFecha > 0) {
    body += `<p style="margin:18px 0 0;font-size:12px;color:#9ca3af">Hay ${plural(sinFecha, "pedido", "pedidos")} sin fecha de despacho asignada todavía por Mercado Libre; no están en esta lista.</p>`;
  }

  const lines = (items) => items.map(i => `  ${i.quantity} x ${i.name} (${i.code})`).join("\n");
  const text = [
    `Despacho de hoy ${d}/${m}/${y}`,
    hoy.items.length ? `${unidadesHoy} unidades en ${hoy.items.length} productos:\n${lines(hoy.items)}` : "No hay pedidos para despachar hoy.",
    sinFecha > 0 ? `\n${sinFecha} pedido(s) sin fecha de despacho asignada todavía.` : "",
  ].filter(Boolean).join("\n");

  return { subject, html: baseLayout(body), text };
}

// Arma (y, si send=true, manda) el resumen de hoy. Devuelve lo armado, por si se quiere ver sin mandar.
export async function runYolodercyeDispatchSummary({ send = true } = {}) {
  const { rows: [seller] } = await pool.query(`SELECT id, email FROM sellers WHERE email = $1`, [SELLER_EMAIL]);
  if (!seller) throw new Error(`[dispatch-summary] no existe el vendedor ${SELLER_EMAIL}`);

  const today = argDay(new Date());
  const candidates = await getCandidateOrders(seller.id);
  await completeAndRefresh(seller.id, candidates);

  const toShip   = candidates.filter(stillToShip);
  const withDay  = toShip.filter(r => r.ml_dispatch_expected_date);
  const hoyRows  = withDay.filter(r => argDay(r.ml_dispatch_expected_date) === today);

  const hoy      = { orders: hoyRows.length, items: await totalsByProduct(hoyRows.map(r => r.id)) };
  const sinFecha = toShip.length - withDay.length;

  const mail = buildEmail({ today, hoy, sinFecha });

  if (send) {
    await transporter.sendMail({
      from:    `"Ventaz" <${process.env.SMTP_FROM_AWS || "noreply@ventaz.com.ar"}>`,
      to:      seller.email,
      subject: mail.subject,
      html:    mail.html,
      text:    mail.text,
    });
    console.log(`[dispatch-summary] enviado a ${seller.email}: ${mail.subject}`);
  }
  return { ...mail, today, hoy, sinFecha };
}

// Próxima 09:00 ART estrictamente posterior a `from`.
export function nextRunAfter(from) {
  const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), HORA_ENVIO_UTC, 0, 0));
  if (next <= from) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

// Un timer hasta la próxima 09:00 ART (en vez de un intervalo que chequea la hora): un reinicio
// del servidor no puede mandar el mail dos veces, y si el servidor estaba caído a las 09:00 ese
// día simplemente no se manda (no hay forma de saber si ya salió sin guardarlo en la base).
export function startYolodercyeDispatchSummary() {
  // marginMs: después de un envío se reprograma a partir de "ahora + 1 minuto", así si el timer
  // hubiera disparado apenas antes de las 09:00 no se vuelve a programar para ese mismo instante
  // (y el mail salía dos veces). Al arrancar el servidor no hace falta: si arranca a las 08:59
  // todavía tiene que mandarse el de ese día.
  const schedule = (marginMs) => {
    const wait = nextRunAfter(new Date(Date.now() + marginMs)).getTime() - Date.now();
    setTimeout(async () => {
      try { await runYolodercyeDispatchSummary(); }
      catch (err) { console.error("[dispatch-summary] error:", err.message); }
      finally { schedule(60_000); }
    }, wait);
    console.log(`[dispatch-summary] próximo resumen en ${Math.round(wait / 60000)} min (09:00 ART)`);
  };
  schedule(0);
}

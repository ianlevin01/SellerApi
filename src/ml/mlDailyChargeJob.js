// Corte diario de cobro de ventas de Mercado Libre — un solo cargo por seller, agrupando todo
// lo pendiente, en vez de cobrar en tiempo real por cada venta.
//
// Cada plan tiene una ventana de gracia (sellerPlan.getPlanMlGraceHours): Inicial no tiene
// gracia (toda la deuda es "obligatoria" desde el día que se generó), Pro tiene 24hs, Max 72hs.
// Todos los días, la parte de la deuda que ya superó su ventana de gracia ("obligatoria") se
// tiene que cobrar sí o sí — si falla, se pausan publicaciones y se bloquea el despacho de esos
// pedidos (ver mlLabelService.js). La parte que todavía está dentro de la ventana ("no
// obligatoria") se intenta cobrar igual, pero si falla no pasa nada, se reintenta al otro día.
//
// HORARIO PROVISORIO: 14:00 ART. Tiene que quedar ANTES del corte real de despacho
// del equipo de operaciones — ajustar HORA_CORTE_UTC cuando se defina ese horario.
import * as wallet from "./mlWalletService.js";
import * as walletRepo from "./mlWalletRepository.js";
import * as listingSvc from "./mlListingService.js";
import { sendMlChargeFailedEmail, sendMlChargeSuccessEmail } from "../email/buyerEmails.js";
import { getSellerPlan, getPlanMlGraceHours } from "../utils/sellerPlan.js";
import pool from "../database/db.js";

const HORA_CORTE_UTC = 17; // 14:00 ART (UTC-3, sin DST) — PROVISORIO, confirmar con operaciones

async function getSellerEmail(sellerId) {
  const { rows } = await pool.query(`SELECT email FROM sellers WHERE id = $1`, [sellerId]);
  return rows[0]?.email;
}

// Intenta cobrar un grupo de órdenes (obligatorias u opcionales), registra el intento en el
// historial (se haya cobrado o no) y avisa por mail. Devuelve true si se cobró bien.
async function chargeGroup(sellerId, orders, kind, email) {
  const total = orders.reduce((sum, o) => sum + Number(o.ml_cost_amount || 0), 0);
  const orderIds = orders.map(o => o.order_id);

  const result = await wallet.debitOrCharge(sellerId, total, {
    mlOrderId:   orders.map(o => o.ml_order_id).join(","),
    description: `Costo de ${orders.length} venta(s) de Mercado Libre (${kind === "mandatory" ? "obligatorio" : "adicional"})`,
  });

  await walletRepo.insertChargeAttempt(sellerId, {
    kind: kind === "mandatory" ? "mandatory" : "optional",
    amount: total, success: result.ok, method: result.method, reason: result.reason, mpPaymentId: result.mpPaymentId,
  });

  if (result.ok) {
    await walletRepo.markOrdersChargeStatus(orderIds, "charged");
    if (email) sendMlChargeSuccessEmail(email, { amount: total }).catch(() => {});
    console.log(`[ml-charge] ✓ seller=${sellerId} cobrado $${total} (${kind}, ${result.method})`);
  } else {
    // se deja 'pending' a propósito — se reintenta en el próximo corte
    if (email) sendMlChargeFailedEmail(email, { amount: total, reason: result.reason, blocking: kind === "mandatory" }).catch(() => {});
    console.warn(`[ml-charge] ✗ seller=${sellerId} no se pudo cobrar $${total} (${kind}, ${result.reason})`);
  }
  return result.ok;
}

export async function runDailyCharge() {
  const bySeller = await walletRepo.getPendingChargesBySeller();
  if (bySeller.size === 0) return;

  console.log(`[ml-charge] procesando ${bySeller.size} vendedor(es) con ventas pendientes`);

  for (const [sellerId, orders] of bySeller) {
    try {
      const { plan_id } = await getSellerPlan(sellerId);
      const graceHours  = getPlanMlGraceHours(plan_id);
      const cutoff       = new Date(Date.now() - graceHours * 3600000);
      const matureOrders   = orders.filter(o => new Date(o.created_at) <= cutoff);
      const immatureOrders = orders.filter(o => new Date(o.created_at) > cutoff);
      const email = await getSellerEmail(sellerId);

      let mandatoryOk = true;
      if (matureOrders.length > 0) {
        mandatoryOk = await chargeGroup(sellerId, matureOrders, "mandatory", email);
        if (!mandatoryOk) {
          await listingSvc.pauseAllSellerListings(sellerId, "charge_failed");
          continue; // no se intenta la opcional si falló la obligatoria
        }
        // se cobró bien la obligatoria — por si venía de un corte anterior fallido, reactivar
        await listingSvc.reactivateListingsAfterChargeSuccess(sellerId).catch(() => {});
      }

      if (immatureOrders.length > 0) {
        await chargeGroup(sellerId, immatureOrders, "optional", email);
      }
    } catch (err) {
      console.error(`[ml-charge] error procesando seller=${sellerId}:`, err.message);
    }
  }
}

export function startMlDailyChargeJob() {
  function msUntilNextCutoff() {
    const now  = new Date();
    const next = new Date(now);
    next.setUTCHours(HORA_CORTE_UTC, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next - now;
  }

  function schedule() {
    const delay = msUntilNextCutoff();
    console.log(`[ml-charge] próxima corrida en ${Math.round(delay / 3600000 * 10) / 10}h`);
    setTimeout(async () => {
      try { await runDailyCharge(); } catch (err) {
        console.error("[ml-charge] error en ejecución:", err.message);
      }
      schedule();
    }, delay);
  }

  schedule();
}

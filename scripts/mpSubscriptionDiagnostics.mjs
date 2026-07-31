/**
 * mpSubscriptionDiagnostics.mjs — trae de la propia API de Mercado Pago el detalle completo de
 * un preapproval (suscripción) y de un authorized_payment puntual, en un solo golpe. Pensado
 * para armar la evidencia que pide soporte de MP cuando un cobro recurrente se queda en
 * "scheduled" sin generar payment (no requiere tocar la base de datos).
 *
 * Uso:
 *   node scripts/mpSubscriptionDiagnostics.mjs <preapproval_id> <authorized_payment_id>
 */
import "dotenv/config";

const MP_BASE = "https://api.mercadopago.com";
const TOKEN = process.env.MP_ACCESS_TOKEN;

async function get(path) {
  const res = await fetch(`${MP_BASE}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  const [preapprovalId, authorizedPaymentId] = process.argv.slice(2);
  if (!TOKEN) { console.error("Falta MP_ACCESS_TOKEN en el .env"); process.exit(1); }
  if (!preapprovalId || !authorizedPaymentId) {
    console.error("Uso: node scripts/mpSubscriptionDiagnostics.mjs <preapproval_id> <authorized_payment_id>");
    process.exit(1);
  }

  console.log(`\n=== GET /preapproval/${preapprovalId} ===`);
  const preapproval = await get(`/preapproval/${preapprovalId}`);
  console.log(`status HTTP: ${preapproval.status}`);
  console.log(JSON.stringify(preapproval.data, null, 2));

  console.log(`\n=== GET /authorized_payments/${authorizedPaymentId} ===`);
  const authPayment = await get(`/authorized_payments/${authorizedPaymentId}`);
  console.log(`status HTTP: ${authPayment.status}`);
  console.log(JSON.stringify(authPayment.data, null, 2));
}

main().catch(err => { console.error("Error:", err); process.exit(1); });

import { getPackagedOrdersWithShipping, markOrderShipped } from "../admin/adminRepository.js";
import { getTracking } from "../shipping/shippingService.js";
import { sendOrderShipped, sendOrderShippedToSeller } from "../email/buyerEmails.js";

const INTERVAL_MS = 30 * 60 * 1000; // 30 minutos

// A package is considered dispatched when MiCorreo has issued a tracking number
// and recorded at least one physical event (i.e. the package was received by Correo).
function isDispatched(tracking) {
  return !!(tracking?.trackingNumber && tracking.events.length > 0);
}

async function checkPackagedOrders() {
  let orders;
  try {
    orders = await getPackagedOrdersWithShipping();
  } catch (err) {
    console.error("[shippingTracker] Error fetching packaged orders:", err.message);
    return;
  }

  if (orders.length === 0) return;
  console.log(`[shippingTracker] Revisando ${orders.length} pedido(s) empaquetado(s)`);

  for (const order of orders) {
    try {
      const tracking = await getTracking(order.id);
      if (!isDispatched(tracking)) continue;

      const shipped = await markOrderShipped(order.id, tracking.trackingNumber);
      if (!shipped) continue; // already transitioned by a concurrent run

      sendOrderShipped({
        customerEmail:  order.customer_email,
        customerName:   order.customer_name,
        orderNumero:    order.numero,
        trackingNumber: tracking.trackingNumber,
      }).catch(err => console.error(`[shippingTracker] Email comprador error order ${order.numero}:`, err.message));

      sendOrderShippedToSeller(order.id, tracking.trackingNumber)
        .catch(err => console.error(`[shippingTracker] Email vendedor error order ${order.numero}:`, err.message));

      console.log(`[shippingTracker] Pedido #${order.numero} marcado como enviado — tracking: ${tracking.trackingNumber}`);
    } catch (err) {
      console.error(`[shippingTracker] Error procesando pedido ${order.id}:`, err.message);
    }
  }
}

export function startShippingTracker() {
  console.log("[shippingTracker] Iniciado — revisión cada 30 minutos");

  // Run once immediately on startup (in case the process was restarted while orders were packaged)
  setTimeout(() => {
    checkPackagedOrders().catch(err => console.error("[shippingTracker] Error inicial:", err.message));
  }, 10_000);

  setInterval(() => {
    checkPackagedOrders().catch(err => console.error("[shippingTracker] Error en ciclo:", err.message));
  }, INTERVAL_MS);
}

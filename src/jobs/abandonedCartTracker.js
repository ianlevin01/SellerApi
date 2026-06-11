import { getInitiatedCartsOlderThan, markContactado } from "../purchase/abandonedCartRepository.js";
import { sendAbandonedCartRecovery } from "../email/buyerEmails.js";

// Horas de espera antes de enviar el email de recuperación (configurable por env var)
const ABANDONED_HOURS = Number(process.env.ABANDONED_CART_HOURS || 2);
const INTERVAL_MS     = 30 * 60 * 1000; // correr cada 30 minutos

async function checkAbandonedCarts() {
  let carts;
  try {
    carts = await getInitiatedCartsOlderThan(ABANDONED_HOURS);
  } catch (err) {
    console.error("[abandonedCartTracker] Error fetching carts:", err.message);
    return;
  }

  if (carts.length === 0) return;
  console.log(`[abandonedCartTracker] ${carts.length} carrito(s) para recuperar`);

  for (const cart of carts) {
    try {
      const storeUrl = process.env.STORE_DOMAIN
        ? `https://${cart.page_slug}.${process.env.STORE_DOMAIN}`
        : null;

      const items = typeof cart.items === "string"
        ? JSON.parse(cart.items)
        : (cart.items || []);

      await sendAbandonedCartRecovery({
        customerEmail: cart.customer_email,
        customerName:  cart.customer_name,
        items,
        total:         Number(cart.total || 0),
        storeUrl,
        storeName:     cart.store_name || cart.page_slug,
      });

      await markContactado(cart.id);
      console.log(`[abandonedCartTracker] Email enviado a ${cart.customer_email} — carrito ${cart.id}`);
    } catch (err) {
      console.error(`[abandonedCartTracker] Error en carrito ${cart.id}:`, err.message);
    }
  }
}

export function startAbandonedCartTracker() {
  console.log(`[abandonedCartTracker] Iniciado — plazo ${ABANDONED_HOURS}h, revisión cada 30 minutos`);

  setTimeout(() => {
    checkAbandonedCarts().catch(err => console.error("[abandonedCartTracker] Error inicial:", err.message));
  }, 15_000);

  setInterval(() => {
    checkAbandonedCarts().catch(err => console.error("[abandonedCartTracker] Error en ciclo:", err.message));
  }, INTERVAL_MS);
}

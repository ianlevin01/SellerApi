import * as repo from "./payoutsRepository.js";
import { getSellerPlatformPct, calcShownCost } from "../utils/pricing.js";

// ── Helpers ───────────────────────────────────────────────────

function validateCbuFormat(cbu) {
  // CVU (billeteras virtuales) y CBU (bancos tradicionales) son ambos 22 dígitos
  // pero el CVU no sigue el checksum de CBU, así que solo validamos el largo
  return /^\d{22}$/.test(cbu);
}

function getPctGanancia(total) {
  if (total >= 1000000) return 0.60;
  if (total >= 500000)  return 0.50;
  if (total >= 100000)  return 0.45;
  return 0.40;
}

// ── CVU ───────────────────────────────────────────────────────

export async function getCvuInfo(sellerId) {
  return repo.getSellerCvu(sellerId);
}

export async function saveCvu(sellerId, { cvu, alias, holderName }) {
  if (!cvu) {
    const err = new Error("El CVU/CBU es requerido");
    err.status = 400;
    throw err;
  }

  const isValidFormat = validateCbuFormat(cvu);
  if (!isValidFormat) {
    const err = new Error("El CVU/CBU ingresado no es válido (debe tener 22 dígitos con formato correcto)");
    err.status = 400;
    throw err;
  }

  let cvuVerified = false;
  let verificationStatus = "pending_manual";

  if (process.env.ARGENAPI_KEY && holderName) {
    try {
      const response = await fetch(
        `https://api.argenapi.com/v1/cbu/${cvu}`,
        { headers: { Authorization: `Bearer ${process.env.ARGENAPI_KEY}` } }
      );

      if (response.ok) {
        const data = await response.json();
        const apiName    = (data.nombre_titular || "").toLowerCase().trim();
        const inputName  = holderName.toLowerCase().trim();

        const nameParts  = inputName.split(/\s+/);
        const nameMatch  = nameParts.every(part => apiName.includes(part));

        if (nameMatch) {
          cvuVerified      = true;
          verificationStatus = "verified";
        } else {
          verificationStatus = "name_mismatch";
        }
      }
    } catch {
      // Si la API falla, seguimos con pending_manual
    }
  }

  await repo.updateSellerCvu(sellerId, {
    cvu,
    cvuAlias:      alias || null,
    cvuHolderName: holderName || null,
    cvuVerified,
  });

  return { verified: cvuVerified, verification_status: verificationStatus };
}

// ── Ganancias ─────────────────────────────────────────────────

export async function getSummary(sellerId) {
  const [cvuInfo, balances, pendingOrders, availableOrders, payouts] = await Promise.all([
    repo.getSellerCvu(sellerId),
    repo.getBalanceSummary(sellerId),
    repo.getEarnings(sellerId, "pending_approval"),
    repo.getEarnings(sellerId, "available"),
    repo.getPayouts(sellerId),
  ]);

  return {
    cvu_info: cvuInfo,
    pending: {
      total:  Number(balances.pending_total),
      orders: pendingOrders,
    },
    available: {
      total:  Number(balances.available_total),
      orders: availableOrders,
    },
    payouts,
  };
}

export async function calculateEarningForOrder(webOrderId) {
  const order = await repo.getOrderForEarning(webOrderId);
  if (!order) return 0;

  // El tier depende del total de ESTE pedido (no del historial acumulado)
  const platformPct = getSellerPlatformPct(Number(order.total));

  // Cotización solo se necesita como fallback para órdenes antiguas sin unit_cost
  let cotizacion = null;

  let ganancia = 0;

  for (const item of order.items) {
    if (!item.product_id) continue;

    let baseCost;
    if (item.unit_cost != null) {
      // Costo bloqueado al momento del checkout (tier 30% con la cotización de ese día)
      baseCost = Number(item.unit_cost);
    } else {
      // Fallback para órdenes anteriores a la migración 018
      if (cotizacion === null) cotizacion = await repo.getCotizacion();
      const costUsd = await repo.getCostUsdForProduct(item.product_id);
      baseCost = calcShownCost(costUsd, cotizacion, 30);
    }

    // Ajustar baseCost al tier real del pedido:
    // baseCost = costo × cotizacion × 1.10 × 1.30
    // adjustedCost = costo × cotizacion × 1.10 × (1 + platformPct/100)
    //              = baseCost × (1 + platformPct/100) / 1.30
    const adjustedCost = baseCost * (1 + platformPct / 100) / 1.30;
    const diferencia   = Number(item.unit_price) - adjustedCost;
    if (diferencia > 0) ganancia += diferencia * item.quantity;
  }

  const freeShippingAbsorbed = Number(order.free_shipping_absorbed || 0);
  return Math.max(0, Number((ganancia - freeShippingAbsorbed).toFixed(2)));
}

export async function createEarningForOrder(webOrderId) {
  const order = await repo.getOrderForEarning(webOrderId);
  if (!order) return;

  const amount = await calculateEarningForOrder(webOrderId);
  await repo.createEarning(order.seller_id, webOrderId, amount);
}

// ── Admin ─────────────────────────────────────────────────────

export async function approveOrderEarning(webOrderId) {
  const updated = await repo.approveOrderEarning(webOrderId);
  if (!updated) {
    const err = new Error("No se encontró ganancia pendiente para esa orden");
    err.status = 404;
    throw err;
  }
}

export async function markPayoutTransferred(payoutId) {
  const updated = await repo.markPayoutTransferred(payoutId);
  if (!updated) {
    const err = new Error("No se encontró el pago o ya fue marcado como transferido");
    err.status = 404;
    throw err;
  }
}

// ── Solicitar transferencia ───────────────────────────────────

export async function requestPayout(sellerId) {
  const cvuInfo = await repo.getSellerCvu(sellerId);

  if (!cvuInfo?.cvu) {
    const err = new Error("Necesitás registrar tu CVU antes de solicitar una transferencia");
    err.status = 400;
    throw err;
  }

  if (!cvuInfo.cvu_verified) {
    const err = new Error("Tu CVU todavía no fue verificado. Aguardá la revisión.");
    err.status = 400;
    throw err;
  }

  const balances = await repo.getBalanceSummary(sellerId);
  const amount   = Number(balances.available_total);

  if (amount <= 0) {
    const err = new Error("No tenés saldo disponible para transferir");
    err.status = 400;
    throw err;
  }

  return repo.createPayout(sellerId, amount, cvuInfo.cvu);
}

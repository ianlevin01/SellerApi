import * as repo from "./payoutsRepository.js";

// ── Helpers ───────────────────────────────────────────────────

function validateCbuFormat(cbu) {
  if (!/^\d{22}$/.test(cbu)) return false;

  function checkDigit(block, weights) {
    const sum = block.split("").reduce((acc, d, i) => acc + Number(d) * weights[i], 0);
    const rem = sum % 10;
    return rem === 0 ? 0 : 10 - rem;
  }

  const w1 = [7, 1, 3, 9, 7, 1, 3];
  const w2 = [3, 7, 1, 3, 9, 7, 1, 3, 7, 1, 3, 7, 1];

  const block1 = cbu.slice(0, 8);
  const block2 = cbu.slice(8, 22);

  if (checkDigit(block1.slice(0, 7), w1) !== Number(block1[7])) return false;
  if (checkDigit(block2.slice(0, 13), w2) !== Number(block2[13])) return false;

  return true;
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

  const cotizacion = await repo.getCotizacion();
  let ganancia_bruta = 0;

  for (const item of order.items) {
    if (!item.product_id) continue;
    const costUsd    = await repo.getCostUsdForProduct(item.product_id);
    const base120    = costUsd * cotizacion * 1.20;
    const diferencia = Number(item.unit_price) - base120;
    if (diferencia > 0) ganancia_bruta += diferencia * item.quantity;
  }

  const total          = Number(order.total);
  const pct_ganancia   = getPctGanancia(total);
  const ganancia_vendedor = ganancia_bruta * pct_ganancia;

  return Math.max(0, Number(ganancia_vendedor.toFixed(2)));
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

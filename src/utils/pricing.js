const BASE_PCT = 30;

export function getSellerPlatformPct(totalSalesARS) {
  if (totalSalesARS >= 500_000) return 20;
  if (totalSalesARS >= 250_000) return 22;
  if (totalSalesARS >= 100_000) return 27.5;
  return BASE_PCT;
}

// Costo mostrado al revendedor: cost_usd × cotizacion × 1.10 × (1 + platformPct/100)
export function calcShownCost(costUsd, cotizacion, platformPct) {
  return Number(costUsd) * Number(cotizacion) * 1.10 * (1 + platformPct / 100);
}

// Ahorro por unidad respecto al tier base (30%)
export function calcSavingsVsBase(costUsd, cotizacion, platformPct) {
  if (platformPct >= BASE_PCT) return 0;
  return Number(costUsd) * Number(cotizacion) * 1.10 * (BASE_PCT - platformPct) / 100;
}

// Info del siguiente tier para mostrar al vendedor
// Retorna null si ya está en el máximo
export function getNextTierInfo(totalSalesARS, platformPct) {
  let nextThreshold, nextPct;

  if (totalSalesARS >= 500_000) return null;

  if (totalSalesARS >= 250_000) { nextThreshold = 500_000; nextPct = 20;   }
  else if (totalSalesARS >= 100_000) { nextThreshold = 250_000; nextPct = 22;   }
  else                               { nextThreshold = 100_000; nextPct = 27.5; }

  return {
    threshold:     nextThreshold,
    remaining:     Math.max(0, nextThreshold - totalSalesARS),
    currentFactor: 1.10 * (1 + platformPct  / 100),
    nextFactor:    1.10 * (1 + nextPct / 100),
  };
}

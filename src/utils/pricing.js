// Tiers: la plataforma se lleva menos margen a medida que el vendedor vende más
export function getSellerPlatformPct(totalSalesARS) {
  if (totalSalesARS >= 1_000_000) return 15;
  if (totalSalesARS >= 500_000)   return 20;
  if (totalSalesARS >= 100_000)   return 25;
  return 30; // base para nuevos vendedores
}

// Costo mostrado al revendedor: cost_usd × cotizacion × 1.20 × (1 + platformPct/100)
export function calcShownCost(costUsd, cotizacion, platformPct) {
  return Number(costUsd) * Number(cotizacion) * 1.20 * (1 + platformPct / 100);
}

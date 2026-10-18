// src/finance/financeRepository.js — carga manual de gastos que Mercado Libre nunca va a poder
// reportar (Ingresos Brutos, gastos fijos del negocio) o que todavía no confirmamos que la API
// exponga (publicidad, ver financeService.js). Los datos reales de venta viven en
// mlStatsRepository.getMonthlyFinanceBreakdown, no acá.
import pool from "../database/db.js";

export async function getEntries(sellerId, monthKeys) {
  const { rows } = await pool.query(
    `SELECT month_key, advertising_ars, gross_receipts_tax_ars, fixed_costs_ars
     FROM seller_monthly_finance
     WHERE seller_id = $1 AND month_key = ANY($2)`,
    [sellerId, monthKeys]
  );
  return rows.map(r => ({
    monthKey:          r.month_key,
    advertising:       Number(r.advertising_ars),
    grossReceiptsTax:  Number(r.gross_receipts_tax_ars),
    fixedCosts:        Number(r.fixed_costs_ars),
  }));
}

export async function upsertEntry(sellerId, monthKey, { advertising, grossReceiptsTax, fixedCosts }) {
  await pool.query(
    `INSERT INTO seller_monthly_finance (seller_id, month_key, advertising_ars, gross_receipts_tax_ars, fixed_costs_ars)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (seller_id, month_key) DO UPDATE SET
       advertising_ars = $3, gross_receipts_tax_ars = $4, fixed_costs_ars = $5, updated_at = now()`,
    [sellerId, monthKey, advertising, grossReceiptsTax, fixedCosts]
  );
}

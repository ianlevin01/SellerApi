// src/finance/financeController.js
import * as financeService from "./financeService.js";

function handleError(res, err) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  console.error(err);
  return res.status(500).json({ message: "Error interno" });
}

export async function getSummary(req, res) {
  try {
    const months = await financeService.getMonthlySummary(req.seller.id, req.query.months);
    return res.json({ months });
  } catch (err) { handleError(res, err); }
}

// GET /seller/finance/range?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function getRangeSummary(req, res) {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ message: "Faltan from/to" });
    const summary = await financeService.getRangeSummary(req.seller.id, from, to);
    return res.json(summary);
  } catch (err) { handleError(res, err); }
}

export async function setMonthlyEntry(req, res) {
  try {
    const { advertising, grossReceiptsTax, fixedCosts } = req.body;
    await financeService.setMonthlyEntry(req.seller.id, req.params.monthKey, { advertising, grossReceiptsTax, fixedCosts });
    return res.json({ message: "Guardado" });
  } catch (err) { handleError(res, err); }
}

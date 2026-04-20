// src/modules/store/storeController.js
import * as storeService from "./storeService.js";

function handleError(res, err) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  console.error(err);
  return res.status(500).json({ message: "Error interno" });
}

export async function getConfig(req, res) {
  try {
    return res.json(await storeService.getConfig(req.seller.id));
  } catch (err) { handleError(res, err); }
}

export async function updateConfig(req, res) {
  try {
    return res.json(await storeService.updateConfig(req.seller.id, req.body));
  } catch (err) { handleError(res, err); }
}

export async function getOrders(req, res) {
  try {
    return res.json(await storeService.getOrders(req.seller.id));
  } catch (err) { handleError(res, err); }
}

export async function getPublicStore(req, res) {
  try {
    return res.json(await storeService.getPublicStore(req.params.slug));
  } catch (err) { handleError(res, err); }
}

export async function createPublicOrder(req, res) {
  try {
    const result = await storeService.createPublicOrder(req.params.slug, req.body);
    return res.status(201).json(result);
  } catch (err) { handleError(res, err); }
}

export async function createCheckout(req, res) {
  try {
    const result = await storeService.createCheckout(req.params.slug, req.body);
    return res.status(201).json(result);
  } catch (err) { handleError(res, err); }
}

export async function getDiscounts(req, res) {
  try {
    return res.json(await storeService.getDiscounts(req.seller.id));
  } catch (err) { handleError(res, err); }
}

export async function updateDiscounts(req, res) {
  try {
    return res.json(await storeService.updateDiscounts(req.seller.id, req.body));
  } catch (err) { handleError(res, err); }
}

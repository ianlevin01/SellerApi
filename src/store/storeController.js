// src/modules/store/storeController.js
import * as storeService   from "./storeService.js";
import * as productsService from "../products/productsService.js";

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
    return res.json(await storeService.getDiscounts(req.params.pageId, req.seller.id));
  } catch (err) { handleError(res, err); }
}

export async function updateDiscounts(req, res) {
  try {
    return res.json(await storeService.updateDiscounts(req.params.pageId, req.seller.id, req.body));
  } catch (err) { handleError(res, err); }
}

// ── Page CRUD ─────────────────────────────────────────────────

export async function getCategories(req, res) {
  try {
    const repo = await import("./storeRepository.js");
    return res.json(await repo.getCategories());
  } catch (err) { handleError(res, err); }
}

export async function getPages(req, res) {
  try {
    return res.json(await storeService.getPages(req.seller.id));
  } catch (err) { handleError(res, err); }
}

export async function createPage(req, res) {
  try {
    const page = await storeService.createPage(req.seller.id, req.body);
    return res.status(201).json(page);
  } catch (err) { handleError(res, err); }
}

export async function getPageConfig(req, res) {
  try {
    return res.json(await storeService.getPageConfig(req.params.pageId, req.seller.id));
  } catch (err) { handleError(res, err); }
}

export async function updatePageConfig(req, res) {
  try {
    return res.json(await storeService.updatePageConfig(req.params.pageId, req.seller.id, req.body));
  } catch (err) { handleError(res, err); }
}

export async function deletePage(req, res) {
  try {
    await storeService.deletePage(req.params.pageId, req.seller.id);
    return res.status(204).end();
  } catch (err) { handleError(res, err); }
}

// ── Per-page products ─────────────────────────────────────────

export async function getPageProducts(req, res) {
  try {
    const { search, category_id, only_mine, limit, offset } = req.query;
    const result = await productsService.getProducts(req.params.pageId, req.seller.id, {
      search,
      categoryId: category_id,
      onlyMine:   only_mine === "true",
      limit:      limit  ? Number(limit)  : 20,
      offset:     offset ? Number(offset) : 0,
    });
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function addPageProduct(req, res) {
  try {
    const result = await productsService.addProduct(req.params.pageId, req.seller.id, req.params.productId);
    return res.status(201).json(result);
  } catch (err) { handleError(res, err); }
}

export async function addAllPageProducts(req, res) {
  try {
    const result = await productsService.addAllProducts(req.params.pageId, req.seller.id);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function removePageProduct(req, res) {
  try {
    const result = await productsService.removeProduct(req.params.pageId, req.params.productId);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function customizePageProduct(req, res) {
  try {
    const result = await productsService.customizeProduct(req.params.pageId, req.seller.id, req.params.productId, req.body);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function getShippingRates(req, res) {
  try {
    const cp = req.query.cp || req.query.postal_code || "";
    if (!cp) return res.status(400).json({ message: "cp requerido" });
    const result = await storeService.getShippingRates(req.params.slug, cp);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function getShippingAgencies(req, res) {
  try {
    const province = req.query.province || req.query.provincia || "";
    if (!province) return res.status(400).json({ message: "province requerida" });
    const result = await storeService.getShippingAgencies(req.params.slug, province);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function setProductPrice(req, res) {
  try {
    const { custom_price } = req.body;
    if (custom_price === undefined || custom_price === null)
      return res.status(400).json({ message: "custom_price requerido" });
    const result = await storeService.setProductPrice(req.params.pageId, req.seller.id, req.params.productId, custom_price);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

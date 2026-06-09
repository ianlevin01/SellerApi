// src/modules/store/storeController.js
import * as storeService      from "./storeService.js";
import * as productsService   from "../products/productsService.js";
import { buildPageWithAI }    from "./aiPageBuilderService.js";
import * as analyticsRepo     from "./analyticsRepository.js";

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

export async function getMyTierInfo(req, res) {
  try {
    return res.json(await storeService.getMyTierInfo());
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

export async function aiConfigPage(req, res) {
  try {
    const { request } = req.body;
    if (!request) return res.status(400).json({ message: "Escribí qué querés para tu tienda" });
    const result = await buildPageWithAI(req.seller.id, req.params.pageId, request);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

// ── Per-page products ─────────────────────────────────────────

export async function getPageProduct(req, res) {
  try {
    const result = await productsService.getProduct(req.params.pageId, req.seller.id, req.params.productId);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function getPageProducts(req, res) {
  try {
    const { search, category_id, only_mine, not_mine, limit, offset } = req.query;
    const result = await productsService.getProducts(req.params.pageId, req.seller.id, {
      search,
      categoryId: category_id,
      onlyMine:   only_mine === "true",
      notMine:    not_mine  === "true",
      limit:      limit  ? Number(limit)  : 20,
      offset:     offset ? Number(offset) : 0,
    });
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function addPageProduct(req, res) {
  try {
    const { custom_price } = req.body;
    const result = await productsService.addProduct(req.params.pageId, req.seller.id, req.params.productId, custom_price);
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

export async function getTransportCompanies(req, res) {
  try {
    const repo = await import("./storeRepository.js");
    return res.json(await repo.getTransportCompanies());
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
    const cp       = req.query.cp || "";
    if (!province) return res.status(400).json({ message: "province requerida" });
    const result = await storeService.getShippingAgencies(req.params.slug, province, cp);
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

export async function setProductPromo(req, res) {
  try {
    const { promo_price, promo_enabled } = req.body;
    const result = await storeService.setProductPromo(
      req.params.pageId, req.seller.id, req.params.productId,
      promo_price, promo_enabled
    );
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

// ── Analytics ─────────────────────────────────────────────────

export async function trackVisit(req, res) {
  try {
    await analyticsRepo.incrementVisit(req.params.slug);
    return res.status(204).end();
  } catch { return res.status(204).end(); }
}

export async function trackCart(req, res) {
  try {
    await analyticsRepo.incrementCart(req.params.slug);
    return res.status(204).end();
  } catch { return res.status(204).end(); }
}

function toART(d) {
  // UTC-3, no DST
  const art = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return art.toISOString().slice(0, 10);
}

export async function getPageAnalytics(req, res) {
  try {
    const { pageId } = req.params;
    const sellerId   = req.seller.id;
    const now = new Date();
    const from = req.query.from || toART(new Date(now.getTime() - 29 * 86400000));
    const to   = req.query.to   || toART(now);
    const data = await analyticsRepo.getAnalytics(pageId, sellerId, from, to);
    return res.json(data);
  } catch (err) { handleError(res, err); }
}

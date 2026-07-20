// src/modules/products/productsController.js
import * as productsService      from "./productsService.js";
import * as productAiService     from "./productAiService.js";
import * as sellerCheckoutService from "./sellerCheckoutService.js";

function handleError(res, err) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  console.error(err);
  return res.status(500).json({ message: "Error interno" });
}

export async function getProduct(req, res) {
  try {
    const result = await productsService.getProduct(null, req.seller.id, req.params.productId);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function getProducts(req, res) {
  try {
    const { search, category_id, only_mine, min_stock, limit, offset } = req.query;
    // Legacy route: uses null pageId (no page filter — shows all system products with seller image data)
    const result = await productsService.getProducts(null, req.seller.id, {
      search,
      categoryId: category_id,
      onlyMine:   only_mine === "true",
      minStock:   min_stock ? Number(min_stock) : null,
      limit:      limit  ? Number(limit)  : 200,
      offset:     offset ? Number(offset) : 0,
    });
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function addProduct(req, res) {
  try {
    const result = await productsService.addProduct(req.seller.id, req.params.productId);
    return res.status(201).json(result);
  } catch (err) { handleError(res, err); }
}

export async function addAllProducts(req, res) {
  try {
    const result = await productsService.addAllProducts(req.seller.id);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function removeProduct(req, res) {
  try {
    const result = await productsService.removeProduct(req.seller.id, req.params.productId);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function customizeProduct(req, res) {
  try {
    const { custom_name, custom_desc } = req.body;
    const result = await productsService.customizeProduct(req.seller.id, req.params.productId, { custom_name, custom_desc });
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

// ── IA: verificar nombre ──────────────────────────────────────────────────────

export async function verifyProductName(req, res) {
  try {
    const { customName } = req.body;
    const originalName = await productAiService.getOriginalProductName(req.params.productId);
    if (!originalName) return res.status(404).json({ message: "Producto no encontrado" });
    const result = await productAiService.verifyProductName(originalName, customName);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

// ── IA: verificar imagen ─────────────────────────────────────────────────────

export async function verifyProductImage(req, res) {
  try {
    const { imageUrl } = req.body;
    if (!imageUrl) return res.status(400).json({ message: "imageUrl requerido" });
    const originalName = await productAiService.getOriginalProductName(req.params.productId);
    if (!originalName) return res.status(404).json({ message: "Producto no encontrado" });
    const result = await productAiService.verifyProductImage(originalName, imageUrl);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

// ── Seller checkout: solicitar producto / reservar stock ──────────────────────

export async function requestProduct(req, res) {
  try {
    const { product_id, shipping, page_id } = req.body;
    if (!product_id) return res.status(400).json({ message: "product_id requerido" });
    if (!shipping?.type) return res.status(400).json({ message: "shipping.type requerido" });
    const result = await sellerCheckoutService.requestProductCheckout(req.seller.id, product_id, shipping, page_id || null);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function reserveStock(req, res) {
  try {
    const { product_id, quantity, page_id } = req.body;
    if (!product_id) return res.status(400).json({ message: "product_id requerido" });
    const result = await sellerCheckoutService.reserveStockCheckout(req.seller.id, product_id, Number(quantity), page_id || null);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function getMyReserves(req, res) {
  try {
    const result = await sellerCheckoutService.getMyReserves(req.seller.id);
    return res.json({ reserves: result });
  } catch (err) { handleError(res, err); }
}

export async function getShippingQuote(req, res) {
  try {
    const { postal_code } = req.query;
    if (!postal_code) return res.status(400).json({ message: "postal_code requerido" });
    const result = await sellerCheckoutService.getShippingQuote(postal_code);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function getShippingAgencies(req, res) {
  try {
    const { province, cp } = req.query;
    if (!province) return res.status(400).json({ message: "province requerido" });
    const result = await sellerCheckoutService.getShippingAgencies(province, cp || "");
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

// ── IA: generar descripción ──────────────────────────────────────────────────

export async function generateDescription(req, res) {
  try {
    const { productName, brief } = req.body;
    if (!productName || !brief?.trim()) return res.status(400).json({ message: "productName y brief son requeridos" });
    const description = await productAiService.generateProductDescription(productName, brief);
    return res.json({ description });
  } catch (err) { handleError(res, err); }
}

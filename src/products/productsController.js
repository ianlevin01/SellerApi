// src/modules/products/productsController.js
import * as productsService  from "./productsService.js";
import * as productAiService from "./productAiService.js";

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
    const { search, category_id, only_mine, limit, offset } = req.query;
    // Legacy route: uses null pageId (no page filter — shows all system products with seller image data)
    const result = await productsService.getProducts(null, req.seller.id, {
      search,
      categoryId: category_id,
      onlyMine:   only_mine === "true",
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

// ── IA: generar descripción ──────────────────────────────────────────────────

export async function generateDescription(req, res) {
  try {
    const { productName, brief } = req.body;
    if (!productName || !brief?.trim()) return res.status(400).json({ message: "productName y brief son requeridos" });
    const description = await productAiService.generateProductDescription(productName, brief);
    return res.json({ description });
  } catch (err) { handleError(res, err); }
}

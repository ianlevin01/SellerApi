// src/modules/products/productsController.js
import * as productsService from "./productsService.js";

function handleError(res, err) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  console.error(err);
  return res.status(500).json({ message: "Error interno" });
}

export async function getProducts(req, res) {
  try {
    const { search, category_id, only_mine, limit, offset } = req.query;
    // Legacy route: uses null pageId (no page filter — shows all system products with seller image data)
    const result = await productsService.getProducts(null, req.seller.id, {
      search,
      categoryId: category_id,
      onlyMine:   false,
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

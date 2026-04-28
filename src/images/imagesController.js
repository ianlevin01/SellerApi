// src/modules/images/imagesController.js
import * as imagesService from "./imagesService.js";

function handleError(res, err) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  console.error(err);
  return res.status(500).json({ message: "Error interno" });
}

export async function getImages(req, res) {
  try {
    const pageId = req.query.pageId || null;
    const result = await imagesService.getImages(req.seller.id, req.params.productId, pageId);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function uploadImage(req, res) {
  try {
    const pageId = req.body.pageId || req.query.pageId || null;
    const result = await imagesService.uploadImage(
      req.seller.id,
      req.params.productId,
      req.file,
      pageId,
    );
    return res.status(201).json(result);
  } catch (err) { handleError(res, err); }
}

export async function deleteImage(req, res) {
  try {
    const result = await imagesService.deleteImage(req.seller.id, req.body.key);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function uploadDescriptionMedia(req, res) {
  try {
    const result = await imagesService.uploadDescriptionMedia(
      req.seller.id,
      req.params.productId,
      req.file,
    );
    return res.status(201).json(result);
  } catch (err) { handleError(res, err); }
}

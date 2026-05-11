import * as combosService from "./combosService.js";

function handleError(res, err) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  console.error(err);
  return res.status(500).json({ message: "Error interno" });
}

export async function getCombos(req, res) {
  try {
    const result = await combosService.getCombos(req.params.pageId, req.seller.id);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function getCombo(req, res) {
  try {
    const result = await combosService.getCombo(req.params.pageId, req.seller.id, req.params.comboId);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function createCombo(req, res) {
  try {
    const result = await combosService.createCombo(req.params.pageId, req.seller.id, req.body);
    return res.status(201).json(result);
  } catch (err) { handleError(res, err); }
}

export async function updateCombo(req, res) {
  try {
    const result = await combosService.updateCombo(req.params.comboId, req.seller.id, req.body);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function deleteCombo(req, res) {
  try {
    await combosService.deleteCombo(req.params.comboId, req.seller.id);
    return res.status(204).end();
  } catch (err) { handleError(res, err); }
}

export async function uploadComboImage(req, res) {
  try {
    const result = await combosService.uploadComboImage(req.params.comboId, req.seller.id, req.file);
    return res.status(201).json(result);
  } catch (err) { handleError(res, err); }
}

export async function deleteComboImage(req, res) {
  try {
    const result = await combosService.deleteComboImage(req.params.comboId, req.seller.id, req.body.key);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function getComboImages(req, res) {
  try {
    const result = await combosService.getComboImages(req.params.comboId, req.seller.id);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

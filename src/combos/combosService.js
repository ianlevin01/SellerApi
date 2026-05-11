import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import s3, { BUCKET, signKey, signKeys } from "../utils/s3Client.js";
import * as combosRepository from "./combosRepository.js";

export async function getCombos(pageId, sellerId) {
  const combos = await combosRepository.findByPage(pageId, sellerId);
  return Promise.all(combos.map(async c => ({
    ...c,
    images: await signKeys(c.image_keys || []),
  })));
}

export async function getPublicCombos(pageId) {
  const combos = await combosRepository.findPublicByPage(pageId);
  return Promise.all(combos.map(async c => {
    const images = await signKeys(c.image_keys || []);
    const products = await Promise.all((c.products || []).map(async p => ({
      ...p,
      images: await signKeys(p.system_images || []),
    })));
    return { ...c, images, products };
  }));
}

export async function getCombo(pageId, sellerId, comboId) {
  const combo = await combosRepository.findById(comboId, sellerId);
  if (!combo) throw { status: 404, message: "Combo no encontrado" };
  const images = await Promise.all(
    (combo.image_keys || []).map(async key => ({ key, url: await signKey(key) }))
  );
  return { ...combo, images };
}

export async function createCombo(pageId, sellerId, body) {
  if (!body.name?.trim()) throw { status: 400, message: "El nombre del combo es requerido" };
  const comboId = await combosRepository.create(pageId, sellerId, body);
  return { id: comboId, message: "Combo creado" };
}

export async function updateCombo(comboId, sellerId, body) {
  const owned = await combosRepository.isOwned(comboId, sellerId);
  if (!owned) throw { status: 404, message: "Combo no encontrado" };
  await combosRepository.update(comboId, sellerId, body);
  return { message: "Combo actualizado" };
}

export async function deleteCombo(comboId, sellerId) {
  const owned = await combosRepository.isOwned(comboId, sellerId);
  if (!owned) throw { status: 404, message: "Combo no encontrado" };
  await combosRepository.remove(comboId, sellerId);
  return { message: "Combo eliminado" };
}

export async function uploadComboImage(comboId, sellerId, file) {
  if (!file) throw { status: 400, message: "No se recibió imagen" };
  const owned = await combosRepository.isOwned(comboId, sellerId);
  if (!owned) throw { status: 404, message: "Combo no encontrado" };

  const ext = file.mimetype.split("/")[1] || "jpg";
  const key = `sellers/${sellerId}/combos/${comboId}/${Date.now()}.${ext}`;

  await s3.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         key,
    Body:        file.buffer,
    ContentType: file.mimetype,
  }));

  await combosRepository.addImage(comboId, sellerId, key);
  const url = await signKey(key);
  return { key, url };
}

export async function deleteComboImage(comboId, sellerId, key) {
  if (!key) throw { status: 400, message: "Key requerida" };
  const owned = await combosRepository.isOwned(comboId, sellerId);
  if (!owned) throw { status: 404, message: "Combo no encontrado" };

  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  await combosRepository.removeImage(comboId, key);
  return { message: "Imagen eliminada" };
}

export async function getComboImages(comboId, sellerId) {
  const owned = await combosRepository.isOwned(comboId, sellerId);
  if (!owned) throw { status: 404, message: "Combo no encontrado" };
  const keys = await combosRepository.getImages(comboId);
  return Promise.all(keys.map(async key => ({ key, url: await signKey(key) })));
}

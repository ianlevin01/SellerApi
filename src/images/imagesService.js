// src/modules/images/imagesService.js
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import s3, { BUCKET, signKey } from "../utils/s3Client.js";
import * as imagesRepository from "./imagesRepository.js";

export async function uploadImage(sellerId, productId, file, pageId = null) {
  if (!file) throw { status: 400, message: "No se recibió imagen" };

  const ext = file.mimetype.split("/")[1] || "jpg";
  const key = `sellers/${sellerId}/products/${productId}/${Date.now()}.${ext}`;

  await s3.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         key,
    Body:        file.buffer,
    ContentType: file.mimetype,
  }));

  const order = await imagesRepository.countImages(sellerId, productId, pageId);
  await imagesRepository.insertImage(sellerId, productId, key, order, pageId);

  const url = await signKey(key);
  return { key, url };
}

// Upload for product description (no DB entry — not shown in gallery)
export async function uploadDescriptionMedia(sellerId, productId, file) {
  if (!file) throw { status: 400, message: "No se recibió archivo" };

  const LIMIT = 5 * 1024 * 1024;
  if (file.size > LIMIT) throw { status: 413, message: "El archivo supera el límite de 5 MB" };

  const ext = file.mimetype.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  const key = `sellers/${sellerId}/desc/${productId}/${Date.now()}.${ext}`;

  await s3.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         key,
    Body:        file.buffer,
    ContentType: file.mimetype,
  }));

  const url = await signKey(key);
  return { key, url };
}

export async function deleteImage(sellerId, key) {
  if (!key) throw { status: 400, message: "Key requerida" };

  const owned = await imagesRepository.isImageOwned(sellerId, key);
  if (!owned)  throw { status: 403, message: "No tenés permiso para borrar esta imagen" };

  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  await imagesRepository.deleteImage(sellerId, key);

  return { message: "Imagen eliminada" };
}

export async function getImages(sellerId, productId, pageId = null) {
  const rows = await imagesRepository.getImages(sellerId, productId, pageId);
  return Promise.all(rows.map(async img => ({
    ...img,
    url: await signKey(img.key),
  })));
}

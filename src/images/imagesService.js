// src/modules/images/imagesService.js
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import s3, { BUCKET, signKey } from "../utils/s3Client.js";
import * as imagesRepository from "./imagesRepository.js";

export async function uploadImage(sellerId, productId, file) {
  if (!file) throw { status: 400, message: "No se recibió imagen" };

  const ext = file.mimetype.split("/")[1] || "jpg";
  const key = `sellers/${sellerId}/products/${productId}/${Date.now()}.${ext}`;

  await s3.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         key,
    Body:        file.buffer,
    ContentType: file.mimetype,
  }));

  const order = await imagesRepository.countImages(sellerId, productId);
  await imagesRepository.insertImage(sellerId, productId, key, order);

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

export async function getImages(sellerId, productId) {
  const rows = await imagesRepository.getImages(sellerId, productId);
  return Promise.all(rows.map(async img => ({
    ...img,
    url: await signKey(img.key),
  })));
}

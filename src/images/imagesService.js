// src/modules/images/imagesService.js
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import s3, { BUCKET, signKey } from "../utils/s3Client.js";
import * as imagesRepository from "./imagesRepository.js";

function publicS3Url(key) {
  const region = process.env.AWS_REGION || "sa-east-1";
  const encodedKey = String(key)
    .split("/")
    .map(part => encodeURIComponent(part))
    .join("/");
  return `https://${BUCKET}.s3.${region}.amazonaws.com/${encodedKey}`;
}

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


// Generic store asset upload (logo, hero, favicon, etc.) — no DB entry.
// Devuelve key + URL firmada para preview. Al guardar la tienda,
// storeService normaliza cualquier URL de S3 a key y la vuelve a firmar al leerla.
export async function uploadStoreAsset(sellerId, assetType, file) {
  if (!file) throw { status: 400, message: "No se recibió imagen" };

  const LIMIT = 2 * 1024 * 1024;
  if (file.size > LIMIT) throw { status: 413, message: "La imagen supera el límite de 2 MB" };

  const allowed = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp"];
  if (!allowed.includes(file.mimetype)) {
    throw { status: 400, message: "Formato no permitido. Usá PNG, JPG, SVG o WEBP" };
  }

  const safeAssetType = String(assetType || "asset")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "asset";

  const ext = (file.mimetype.split("/")[1] || "jpg")
    .replace("jpeg", "jpg")
    .replace("svg+xml", "svg");

  const key = `sellers/${sellerId}/assets/${safeAssetType}/${Date.now()}.${ext}`;

  await s3.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         key,
    Body:        file.buffer,
    ContentType: file.mimetype,
  }));

  const url = await signKey(key);
  return { key, url };
}

export async function uploadLogo(sellerId, file) {
  return uploadStoreAsset(sellerId, "logo", file);
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

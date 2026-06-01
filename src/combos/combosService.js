import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import s3, { BUCKET, signKey, signKeys } from "../utils/s3Client.js";
import * as combosRepository from "./combosRepository.js";
import * as storeRepository from "../store/storeRepository.js";
import { calcShownCost } from "../utils/pricing.js";

export async function getCombos(pageId, sellerId) {
  const [combos, cotizacion] = await Promise.all([
    combosRepository.findByPage(pageId, sellerId),
    storeRepository.getCotizacion(),
  ]);

  return Promise.all(combos.map(async c => {
    const comboCostMin = (c.products || []).reduce((sum, p) => {
      return sum + calcShownCost(p.cost_usd || 0, cotizacion, 30) * (p.quantity || 1);
    }, 0);
    return {
      ...c,
      images:          await signKeys(c.image_keys || []),
      combo_cost_min:  Math.round(comboCostMin),
    };
  }));
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

const FREE_SHIPPING_MIN_MARGIN = 15000;

export async function updateCombo(comboId, sellerId, body) {
  const owned = await combosRepository.isOwned(comboId, sellerId);
  if (!owned) throw { status: 404, message: "Combo no encontrado" };

  const customPrice = Number(body.custom_price || 0);
  const freeShip    = Boolean(body.free_shipping);

  // Calcular precio mínimo real basado en costos de los productos del combo
  const [totalCostUsd, cotizacion] = await Promise.all([
    combosRepository.getComboTotalCostUsd(comboId),
    storeRepository.getCotizacion(),
  ]);
  const minRequired = totalCostUsd > 0
    ? Math.round(calcShownCost(totalCostUsd, cotizacion, 30))
    : 0;
  const minPrice = freeShip && minRequired > 0
    ? minRequired + FREE_SHIPPING_MIN_MARGIN
    : minRequired;

  // Validar precio regular (requerido y >= mínimo)
  if (customPrice <= 0) {
    throw { status: 400, message: "El precio del combo es requerido." };
  }
  if (minPrice > 0 && customPrice < minPrice) {
    throw { status: 400, message: `El precio mínimo para este combo es $${minPrice.toLocaleString("es-AR")}.` };
  }

  // Validar precio promo
  if (body.promo_price !== undefined && body.promo_price !== null) {
    const promoPrice = Number(body.promo_price);

    if (promoPrice > 0) {
      if (minPrice > 0 && promoPrice < minPrice) {
        throw { status: 400, message: `El precio promo no puede ser menor al mínimo permitido ($${minPrice.toLocaleString("es-AR")}).` };
      }
      if (customPrice > 0 && promoPrice >= customPrice) {
        throw { status: 400, message: "El precio promo debe ser menor al precio regular del combo." };
      }
      body = { ...body, promo_enabled: true, promo_price: promoPrice };
    } else {
      body = { ...body, promo_enabled: false, promo_price: null };
    }
  }

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

// src/modules/products/productsService.js
import * as productsRepository from "./productsRepository.js";
import { getCotizacion, getPageById } from "../store/storeRepository.js";
import { signKeys } from "../utils/s3Client.js";

export async function getProducts(pageId, sellerId, filters) {
  const limit  = Math.min(Number(filters.limit) || 20, 50);
  const offset = Number(filters.offset) || 0;

  const [{ rows, total }, cotizacion] = await Promise.all([
    productsRepository.findAll({ pageId, sellerId, ...filters, limit, offset }),
    getCotizacion(),
  ]);

  const products = await Promise.all(rows.map(async p => {
    const precio_1 = p.costo_usd ? Number(p.costo_usd) * cotizacion * 1.44 : null;
    return {
      ...p,
      precio_1,
      custom_price:  p.custom_price ? Number(p.custom_price) : null,
      system_images: await signKeys(p.system_images || []),
      seller_images: await signKeys(p.seller_images || []),
    };
  }));

  return { products, total, limit, offset, hasMore: offset + limit < total };
}

export async function addProduct(pageId, sellerId, productId) {
  if (!productId) throw { status: 400, message: "productId requerido" };
  await productsRepository.addProduct(pageId, sellerId, productId);
  return { message: "Producto agregado a la tienda" };
}

export async function addAllProducts(pageId, sellerId) {
  await productsRepository.addAllProducts(pageId, sellerId);
  return { message: "Todos los productos agregados" };
}

export async function removeProduct(pageId, productId) {
  await productsRepository.removeProduct(pageId, productId);
  return { message: "Producto quitado de la tienda" };
}

export async function customizeProduct(pageId, sellerId, productId, data) {
  if (!productId) throw { status: 400, message: "productId requerido" };
  await productsRepository.customizeProduct(pageId, sellerId, productId, data);
  return { message: "Producto actualizado" };
}

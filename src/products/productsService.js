// src/modules/products/productsService.js
import * as productsRepository from "./productsRepository.js";
import { getCotizacion } from "../store/storeRepository.js";
import { signKeys } from "../utils/s3Client.js";

export async function getProducts(sellerId, filters) {
  const limit  = Math.min(Number(filters.limit) || 20, 50);
  const offset = Number(filters.offset) || 0;

  const [{ rows, total }, cotizacion] = await Promise.all([
    productsRepository.findAll({ sellerId, ...filters, limit, offset }),
    getCotizacion(),
  ]);

  const products = await Promise.all(rows.map(async p => ({
    ...p,
    precio_1: p.precio_1 ? Number(p.precio_1) * cotizacion : null,
    system_images: await signKeys(p.system_images || []),
    seller_images: await signKeys(p.seller_images || []),
  })));

  return { products, total, limit, offset, hasMore: offset + limit < total };
}

export async function addProduct(sellerId, productId) {
  if (!productId) throw { status: 400, message: "productId requerido" };
  await productsRepository.addProduct(sellerId, productId);
  return { message: "Producto agregado a tu tienda" };
}

export async function addAllProducts(sellerId) {
  await productsRepository.addAllProducts(sellerId);
  return { message: "Todos los productos agregados" };
}

export async function removeProduct(sellerId, productId) {
  await productsRepository.removeProduct(sellerId, productId);
  return { message: "Producto quitado de tu tienda" };
}

export async function customizeProduct(sellerId, productId, data) {
  if (!productId) throw { status: 400, message: "productId requerido" };
  await productsRepository.customizeProduct(sellerId, productId, data);
  return { message: "Producto actualizado" };
}

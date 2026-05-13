// src/modules/products/productsService.js
import * as productsRepository from "./productsRepository.js";
import { getCotizacion, getPageById, getSellerTotalSales } from "../store/storeRepository.js";
import { signKeys } from "../utils/s3Client.js";
import { getSellerPlatformPct, calcShownCost } from "../utils/pricing.js";

export async function getProduct(pageId, sellerId, productId) {
  const [row, cotizacion, totalSales] = await Promise.all([
    productsRepository.findById(pageId, sellerId, productId),
    getCotizacion(),
    getSellerTotalSales(sellerId),
  ]);
  if (!row) throw { status: 404, message: "Producto no encontrado" };
  const platformPct = getSellerPlatformPct(totalSales);
  return {
    ...row,
    precio_1:           row.costo_usd ? calcShownCost(row.costo_usd, cotizacion, platformPct) : null,
    platform_margin_pct: platformPct,
    custom_price:        row.custom_price ? Number(row.custom_price) : null,
    system_images:       await signKeys(row.system_images || []),
    seller_images:       await signKeys(row.seller_images || []),
  };
}

export async function getProducts(pageId, sellerId, filters) {
  const limit  = Math.min(Number(filters.limit) || 20, 500);
  const offset = Number(filters.offset) || 0;

  const [{ rows, total }, cotizacion, totalSales] = await Promise.all([
    productsRepository.findAll({ pageId, sellerId, ...filters, limit, offset }),
    getCotizacion(),
    getSellerTotalSales(sellerId),
  ]);
  const platformPct = getSellerPlatformPct(totalSales);

  const products = await Promise.all(rows.map(async p => {
    const precio_1 = p.costo_usd ? calcShownCost(p.costo_usd, cotizacion, platformPct) : null;
    return {
      ...p,
      precio_1,
      platform_margin_pct: platformPct,
      custom_price:  p.custom_price ? Number(p.custom_price) : null,
      system_images: await signKeys(p.system_images || []),
      seller_images: await signKeys(p.seller_images || []),
    };
  }));

  return { products, total, limit, offset, hasMore: offset + limit < total };
}

export async function addProduct(pageId, sellerId, productId, customPrice) {
  if (!productId) throw { status: 400, message: "productId requerido" };
  await productsRepository.addProduct(pageId, sellerId, productId, customPrice);
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

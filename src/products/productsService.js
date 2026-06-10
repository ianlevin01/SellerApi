// src/modules/products/productsService.js
import * as productsRepository from "./productsRepository.js";
import { getCotizacion, getPageById, getCostUsdForProduct, getSellerProduct } from "../store/storeRepository.js";
import { signKeys } from "../utils/s3Client.js";
import { calcShownCost } from "../utils/pricing.js";
import { getSellerPlan } from "../utils/sellerPlan.js";

export async function getProduct(pageId, sellerId, productId) {
  const [row, cotizacion, { plan_id }] = await Promise.all([
    productsRepository.findById(pageId, sellerId, productId),
    getCotizacion(),
    getSellerPlan(sellerId),
  ]);
  if (!row) throw { status: 404, message: "Producto no encontrado" };
  return {
    ...row,
    precio_1:           row.costo_usd ? calcShownCost(row.costo_usd, cotizacion, 30, plan_id) : null,
    platform_margin_pct: 30,
    custom_price:        row.custom_price ? Number(row.custom_price) : null,
    system_images:       await signKeys(row.system_images || []),
    seller_images:       await signKeys(row.seller_images || []),
  };
}

export async function getProducts(pageId, sellerId, filters) {
  const limit  = Math.min(Number(filters.limit) || 20, 500);
  const offset = Number(filters.offset) || 0;

  const [{ rows, total }, cotizacion, { plan_id }] = await Promise.all([
    productsRepository.findAll({ pageId, sellerId, ...filters, limit, offset }),
    getCotizacion(),
    getSellerPlan(sellerId),
  ]);

  const products = await Promise.all(rows.map(async p => {
    const precio_1 = p.costo_usd ? calcShownCost(p.costo_usd, cotizacion, 30, plan_id) : null;
    return {
      ...p,
      precio_1,
      platform_margin_pct: 30,
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

const FREE_SHIPPING_MIN_MARGIN = 15000;

export async function customizeProduct(pageId, sellerId, productId, data) {
  if (!productId) throw { status: 400, message: "productId requerido" };

  if (data.free_shipping === true) {
    const [cotizacion, costUsd, sellerProduct, { plan_id }] = await Promise.all([
      getCotizacion(),
      getCostUsdForProduct(productId),
      getSellerProduct(pageId, productId),
      getSellerPlan(sellerId),
    ]);

    if (costUsd > 0) {
      const precio1     = calcShownCost(costUsd, cotizacion, 30, plan_id);
      const minRequired = Math.ceil(precio1 + FREE_SHIPPING_MIN_MARGIN);

      const promoActiva   = sellerProduct?.promo_enabled && Number(sellerProduct?.promo_price) > 0;
      const effectivePrice = promoActiva
        ? Number(sellerProduct.promo_price)
        : Number(sellerProduct?.custom_price || 0);

      if (effectivePrice < minRequired) {
        const label = promoActiva ? "El precio promocional" : "El precio";
        throw {
          status: 400,
          message: `${label} es insuficiente para activar envío gratis. El precio mínimo es $${minRequired.toLocaleString("es-AR")}.`,
        };
      }
    }
  }

  await productsRepository.customizeProduct(pageId, sellerId, productId, data);
  return { message: "Producto actualizado" };
}

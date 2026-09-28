// Estima peso (g) y volumen (cm³) de un producto con GPT-4o-mini cuando todavía no los tiene
// cargados — misma lógica que scripts/inferDimensions.js (backfill masivo), extraída acá para
// poder llamarla también al publicar en Mercado Libre y no depender de que el backfill ya haya
// pasado por ese producto puntual.
import OpenAI from "openai";
import pool from "../database/db.js";
import { signKey } from "../utils/s3Client.js";

let _client = null;
function getClient() {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY no configurada");
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

// ── Shrinkage — ver scripts/inferDimensions.js para el detalle de por qué existe: encoge la
// estimación cruda de la IA hacia un promedio del catálogo (ajustado por precio) en espacio
// logarítmico, más fuerte cuanto menos confianza reportó la propia IA. ──────────────────────
const MEAN_WEIGHT = 500;  // g
const MEAN_VOLUME = 400;  // cm³
const ALPHA = { high: 0.08, medium: 0.35, low: 0.75 };
const MEDIAN_COST_USD = 9;
const PRICE_EXPONENT  = 0.35;
const PRICE_WEIGHT    = 0.15;

function priceAdjustedTarget(mean, costoUsd) {
  if (!costoUsd || costoUsd <= 0) return mean;
  const factor = Math.pow(costoUsd / MEDIAN_COST_USD, PRICE_EXPONENT);
  return mean * Math.pow(factor, PRICE_WEIGHT);
}

function shrink(predicted, target, confidence) {
  const alpha = ALPHA[confidence] ?? 0.35;
  return Math.round(Math.exp((1 - alpha) * Math.log(predicted) + alpha * Math.log(target)));
}

function applyBoundsAndShrink(rawWeight, rawVolume, confidence, costoUsd) {
  const targetWeight = priceAdjustedTarget(MEAN_WEIGHT, costoUsd);
  const targetVolume = priceAdjustedTarget(MEAN_VOLUME, costoUsd);
  const weight = Math.min(Math.max(shrink(rawWeight, targetWeight, confidence), 50), 25000);
  const volume = Math.min(Math.max(shrink(rawVolume, targetVolume, confidence), 100), 80000);
  return { weight, volume };
}

async function getProductImages(productId) {
  const { rows } = await pool.query(
    `SELECT key FROM product_images WHERE product_id = $1 ORDER BY id LIMIT 3`,
    [productId]
  );
  return rows.map(r => r.key);
}

async function inferWithOpenAI(product, imageUrls) {
  const namePart = product.name;
  const descPart = product.description ? ` Descripción: "${product.description}".` : "";
  const catPart  = product.category   ? ` Categoría: "${product.category}".`    : "";

  const prompt =
    `Sos un experto en logística de e-commerce. Analizá este producto y estimá su volumen de embalaje ` +
    `(largo × ancho × alto en cm³) y peso en gramos para envío postal estándar. ` +
    `Producto: "${namePart}".${descPart}${catPart}\n\n` +
    `Respondé SOLO con JSON válido, sin texto adicional:\n` +
    `{"weight_grams": <entero>, "volume_cm3": <entero>, "confidence": "high"|"medium"|"low"}`;

  const content = [{ type: "text", text: prompt }];
  for (const url of imageUrls) {
    if (url) content.push({ type: "image_url", image_url: { url, detail: "low" } });
  }

  const response = await getClient().chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content }],
    max_tokens: 150,
    response_format: { type: "json_object" },
  });

  const text = response.choices[0]?.message?.content || "";
  return JSON.parse(text);
}

// Trae los datos del producto y calcula peso/volumen SIN guardar nada — separado de
// estimateAndSaveDimensions para que el backfill masivo (scripts/inferDimensions.js) pueda
// loguear raw→final y soportar --dry sin duplicar la lógica de estimación.
export async function computeProductDimensions(productId) {
  const { rows } = await pool.query(`
    SELECT p.id, p.name, p.description, p.costo_usd, c.name AS category
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.id = $1
  `, [productId]);
  const product = rows[0];
  if (!product) return null;

  const keys      = await getProductImages(product.id);
  const imageUrls = await Promise.all(keys.map(k => signKey(k)));
  const validUrls = imageUrls.filter(Boolean);

  let result;
  try {
    result = await inferWithOpenAI(product, validUrls);
  } catch (err) {
    if (/unsupported image/i.test(err.message) && validUrls.length > 0) {
      // Alguna foto está en un formato que GPT no acepta — reintentar solo con nombre/descripción
      // en vez de dejar al producto sin estimar.
      result = await inferWithOpenAI(product, []);
    } else {
      throw err;
    }
  }

  const rawWeight = Math.round(Number(result.weight_grams));
  const rawVolume = Math.round(Number(result.volume_cm3));
  if (!rawWeight || !rawVolume || isNaN(rawWeight) || isNaN(rawVolume)) {
    throw new Error("La estimación de peso/volumen no devolvió valores válidos");
  }

  const confidence = result.confidence || "medium";
  const { weight, volume } = applyBoundsAndShrink(rawWeight, rawVolume, confidence, Number(product.costo_usd));
  return { weightGrams: weight, volumeCm3: volume, rawWeight, rawVolume, confidence, productName: product.name };
}

export async function saveDimensions(productId, weightGrams, volumeCm3) {
  const { rowCount } = await pool.query(
    `UPDATE products SET weight_grams = $1, volume_cm3 = $2 WHERE id = $3`,
    [weightGrams, volumeCm3, productId]
  );
  return rowCount > 0;
}

// Estima y persiste weight_grams/volume_cm3 para un producto puntual — usado al vuelo por el
// flujo de publicar en ML cuando el producto todavía no tiene esos valores cargados (ver
// getProductForListing en mlListingService.js). Devuelve { weightGrams, volumeCm3 } o null si
// el producto no existe.
export async function estimateAndSaveDimensions(productId) {
  const computed = await computeProductDimensions(productId);
  if (!computed) return null;
  await saveDimensions(productId, computed.weightGrams, computed.volumeCm3);
  return { weightGrams: computed.weightGrams, volumeCm3: computed.volumeCm3 };
}

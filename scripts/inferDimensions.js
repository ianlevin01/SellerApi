/**
 * inferDimensions.js — infiere peso (g) y volumen (cm³) de cada producto usando GPT-4o-mini
 *
 * Uso:
 *   node scripts/inferDimensions.js           # procesa solo los que tienen weight_grams IS NULL
 *   node scripts/inferDimensions.js --all      # re-procesa todos
 *   node scripts/inferDimensions.js --dry      # muestra output sin guardar en BD
 *   node scripts/inferDimensions.js --limit 20 # limita la cantidad a procesar
 */

import { readFile, writeFile, access } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import OpenAI from "openai";
import pool from "../src/database/db.js";
import { signKey } from "../src/utils/s3Client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "../.env") });

const PROGRESS_FILE = join(__dirname, "infer_progress.json");
const DELAY_MS = 250; // ms entre llamadas a la API

const args = process.argv.slice(2);
const DRY  = args.includes("--dry");
const ALL  = args.includes("--all");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : null;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Shrinkage ────────────────────────────────────────────────────────────────
const MEAN_WEIGHT = 500;  // g
const MEAN_VOLUME = 400;  // cm³

const ALPHA = { high: 0.1, medium: 0.3, low: 0.55 };

function shrink(predicted, mean, confidence) {
  const alpha = ALPHA[confidence] ?? 0.3;
  return Math.round(Math.exp((1 - alpha) * Math.log(predicted) + alpha * Math.log(mean)));
}

function applyBoundsAndShrink(rawWeight, rawVolume, confidence) {
  const weight = Math.min(Math.max(shrink(rawWeight, MEAN_WEIGHT, confidence), 50), 25000);
  const volume = Math.min(Math.max(shrink(rawVolume, MEAN_VOLUME, confidence), 100), 80000);
  return { weight, volume };
}

async function loadProgress() {
  try {
    await access(PROGRESS_FILE);
    const raw = await readFile(PROGRESS_FILE, "utf8");
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

async function saveProgress(done) {
  await writeFile(PROGRESS_FILE, JSON.stringify([...done]), "utf8");
}

async function getProducts() {
  const where = ALL
    ? "WHERE p.active = true"
    : "WHERE p.active = true AND p.weight_grams IS NULL";
  const limitClause = LIMIT ? `LIMIT ${LIMIT}` : "";
  const { rows } = await pool.query(`
    SELECT p.id, p.name, p.description, c.name AS category
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    ${where}
    ORDER BY p.name
    ${limitClause}
  `);
  return rows;
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

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content }],
    max_tokens: 150,
    response_format: { type: "json_object" },
  });

  const text = response.choices[0]?.message?.content || "";
  return JSON.parse(text);
}

async function updateProduct(productId, weightGrams, volumeCm3) {
  await pool.query(
    `UPDATE products SET weight_grams = $1, volume_cm3 = $2 WHERE id = $3`,
    [weightGrams, volumeCm3, productId]
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  if (DRY) {
    console.log("=".repeat(60));
    console.log("  ⚠️  DRY RUN — no se guarda nada en la base de datos");
    console.log("=".repeat(60));
  }
  console.log(`[inferDimensions] modo: ${DRY ? "DRY RUN" : "LIVE"} | scope: ${ALL ? "todos" : "solo NULL"}`);

  const products = await getProducts();
  console.log(`[inferDimensions] productos a procesar: ${products.length}`);

  const done    = await loadProgress();
  let processed = 0;
  let skipped   = 0;
  let errors    = 0;

  for (const product of products) {
    if (done.has(product.id) && !DRY) {
      skipped++;
      continue;
    }

    const keys      = await getProductImages(product.id);
    const imageUrls = await Promise.all(keys.map(k => signKey(k)));
    const validUrls = imageUrls.filter(Boolean);

    let result;
    try {
      result = await inferWithOpenAI(product, validUrls);
    } catch (err) {
      // retry once
      await sleep(1000);
      try {
        result = await inferWithOpenAI(product, validUrls);
      } catch (err2) {
        console.error(`  ✗ ${product.name}: ${err2.message}`);
        errors++;
        continue;
      }
    }

    const rawWeight = Math.round(Number(result.weight_grams));
    const rawVolume = Math.round(Number(result.volume_cm3));

    if (!rawWeight || !rawVolume || isNaN(rawWeight) || isNaN(rawVolume)) {
      console.error(`  ✗ ${product.name}: JSON inválido →`, result);
      errors++;
      continue;
    }

    const conf = result.confidence || "medium";
    const { weight, volume } = applyBoundsAndShrink(rawWeight, rawVolume, conf);

    console.log(
      `  [${conf}] ${product.name.slice(0, 48).padEnd(48)} ` +
      `raw=${rawWeight}g→${weight}g  ${rawVolume}cm³→${volume}cm³`
    );

    if (!DRY) {
      try {
        const result = await pool.query(
          `UPDATE products SET weight_grams = $1, volume_cm3 = $2 WHERE id = $3 RETURNING id`,
          [weight, volume, product.id]
        );
        if (result.rowCount === 0) {
          console.error(`  ✗ ${product.name}: UPDATE no encontró el producto en la BD (id=${product.id})`);
          errors++;
          continue;
        }
        console.log(`     ✓ guardado en BD`);
      } catch (dbErr) {
        console.error(`  ✗ ${product.name}: error al guardar → ${dbErr.message}`);
        errors++;
        continue;
      }
      done.add(product.id);
      if (processed % 20 === 0) await saveProgress(done);
    }

    processed++;
    await sleep(DELAY_MS);
  }

  if (!DRY) await saveProgress(done);

  console.log(`\n[inferDimensions] listo — procesados: ${processed} | saltados: ${skipped} | errores: ${errors}`);
  await pool.end();
}

main().catch(err => {
  console.error("[inferDimensions] error fatal:", err.message);
  process.exit(1);
});

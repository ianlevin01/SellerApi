/**
 * inferDimensions.js — infiere peso (g) y volumen (cm³) de cada producto usando GPT-4o-mini
 *
 * Usa la misma lógica de estimación que el fallback en vivo del flujo de publicar en ML
 * (ver src/products/productDimensionsService.js) — un solo lugar con el algoritmo real.
 *
 * Uso:
 *   node scripts/inferDimensions.js           # procesa solo los que tienen weight_grams IS NULL
 *   node scripts/inferDimensions.js --all      # re-procesa todos
 *   node scripts/inferDimensions.js --dry      # muestra output sin guardar en BD
 *   node scripts/inferDimensions.js --limit 20 # limita la cantidad a procesar
 */

import "dotenv/config"; // debe ser el primer import — s3Client.js lee process.env al cargarse
import { readFile, writeFile, access } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pool from "../src/database/db.js";
import { computeProductDimensions, saveDimensions } from "../src/products/productDimensionsService.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROGRESS_FILE = join(__dirname, "infer_progress.json");
const DELAY_MS = 250; // ms entre llamadas a la API

const args = process.argv.slice(2);
const DRY  = args.includes("--dry");
const ALL  = args.includes("--all");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : null;

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
    SELECT p.id, p.name
    FROM products p
    ${where}
    ORDER BY p.created_at DESC
    ${limitClause}
  `);
  return rows;
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

    let computed;
    try {
      computed = await computeProductDimensions(product.id);
    } catch (err) {
      console.error(`  ✗ ${product.name}: ${err.message}`);
      errors++;
      continue;
    }
    if (!computed) {
      console.error(`  ✗ ${product.name}: producto no encontrado`);
      errors++;
      continue;
    }

    console.log(
      `  [${computed.confidence}] ${product.name.slice(0, 48).padEnd(48)} ` +
      `raw=${computed.rawWeight}g→${computed.weightGrams}g  ${computed.rawVolume}cm³→${computed.volumeCm3}cm³`
    );

    if (!DRY) {
      try {
        const ok = await saveDimensions(product.id, computed.weightGrams, computed.volumeCm3);
        if (!ok) {
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

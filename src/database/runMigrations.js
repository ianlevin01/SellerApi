// src/database/runMigrations.js
// Corre automáticamente al iniciar el servidor.
// Busca todos los archivos .sql en ./migrations/ y los ejecuta en orden,
// registrando cada uno en la tabla schema_migrations para no repetirlos.

import { readdir, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pool from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "migrations");

export async function runMigrations() {
  // Crear tabla de control si no existe
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename  TEXT PRIMARY KEY,
      ran_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(MIGRATIONS_DIR))
    .filter(f => f.endsWith(".sql"))
    .sort();

  for (const filename of files) {
    const { rows } = await pool.query(
      "SELECT 1 FROM schema_migrations WHERE filename = $1",
      [filename]
    );
    if (rows.length > 0) continue; // ya ejecutada

    const sql = await readFile(join(MIGRATIONS_DIR, filename), "utf8");
    console.log(`[migrations] ejecutando ${filename}…`);
    try {
      await pool.query(sql);
    } catch (err) {
      console.error(`[migrations] ✗ ${filename}:`, err.message);
      throw err;
    }
    await pool.query(
      "INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING",
      [filename]
    );
    console.log(`[migrations] ✓ ${filename}`);
  }
}

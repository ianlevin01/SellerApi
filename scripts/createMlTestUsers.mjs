/**
 * createMlTestUsers.mjs — crea dos usuarios de prueba de Mercado Libre (uno para usar como
 * vendedor, conectándolo a Ventaz, y otro para usar como comprador) usando el token real de
 * algún vendedor ya conectado a la app.
 *
 * ML no expone ningún endpoint para volver a consultar los usuarios de prueba ya creados ni
 * sus contraseñas — hay que guardar el resultado apenas se imprime.
 *
 * Uso: node scripts/createMlTestUsers.mjs
 */
import "dotenv/config";
import pool from "../src/database/db.js";
import { getValidToken } from "../src/ml/mlTokenService.js";
import * as svc from "../src/ml/mlService.js";

async function findWorkingConnection() {
  const { rows } = await pool.query(
    `SELECT c.seller_id, c.site_id, s.email, s.name
     FROM ml_connections c JOIN sellers s ON s.id = c.seller_id
     WHERE c.ml_user_id IS NOT NULL`
  );
  for (const conn of rows) {
    try {
      const token = await getValidToken(conn.seller_id);
      if (!token) continue;
      const user = await svc.getUser(token); // valida que el token realmente funcione contra la API
      return { ...conn, token, mlUser: user };
    } catch {
      continue; // esta conexión tiene el token revocado/inactivo — probar la siguiente
    }
  }
  return null;
}

async function main() {
  console.log("Buscando una conexión de Mercado Libre que tenga el token vigente...");
  const working = await findWorkingConnection();
  if (!working) {
    console.error("Ninguna de las conexiones de ml_connections tiene un token que funcione ahora mismo.");
    console.error("Reconectá algún vendedor desde Integraciones en SellerSystem y volvé a correr este script.");
    process.exit(1);
  }
  console.log(`Usando la conexión de ${working.name} (${working.email}) — ML nickname: ${working.mlUser.nickname}\n`);

  const siteId = working.site_id || "MLA";
  const seller = await svc.createTestUser(working.token, siteId);
  const buyer  = await svc.createTestUser(working.token, siteId);

  console.log("✅ Usuario de prueba VENDEDOR (conectá este a Ventaz desde Integraciones):");
  console.log(JSON.stringify(seller, null, 2));
  console.log("\n✅ Usuario de prueba COMPRADOR (usalo para comprar la publicación de prueba):");
  console.log(JSON.stringify(buyer, null, 2));
  console.log("\nGuardá estos datos ahora — Mercado Libre no permite volver a consultarlos después.");
  console.log(`Para loguearte con cualquiera de los dos: mercadolibre.com.ar → Ingresar → usá el "nickname" (o el email/id que haya devuelto) como usuario, y el "password" tal cual — sin cambiarla.`);

  await pool.end();
}

main().catch(err => { console.error("Error:", err.message); process.exit(1); });

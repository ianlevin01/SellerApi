// src/modules/images/imagesRepository.js
import pool from "../database/db.js"

export async function countImages(sellerId, productId, pageId = null) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) FROM seller_images
     WHERE seller_id = $1 AND product_id = $2
       AND ($3::uuid IS NULL OR page_id = $3)
       AND ($3::uuid IS NOT NULL OR page_id IS NULL)`,
    [sellerId, productId, pageId]
  );
  return Number(rows[0].count);
}

export async function insertImage(sellerId, productId, key, order, pageId = null) {
  await pool.query(
    `INSERT INTO seller_images (seller_id, product_id, key, "order", page_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [sellerId, productId, key, order, pageId]
  );
}

export async function isImageOwned(sellerId, key) {
  const { rows } = await pool.query(
    `SELECT id FROM seller_images WHERE seller_id = $1 AND key = $2`,
    [sellerId, key]
  );
  return rows.length > 0;
}

export async function deleteImage(sellerId, key) {
  await pool.query(
    `DELETE FROM seller_images WHERE seller_id = $1 AND key = $2`,
    [sellerId, key]
  );
}

export async function getImages(sellerId, productId, pageId = null) {
  const { rows } = await pool.query(
    `SELECT id, key, "order", page_id
     FROM seller_images
     WHERE seller_id = $1 AND product_id = $2
       AND ($3::uuid IS NULL OR page_id = $3)
       AND ($3::uuid IS NOT NULL OR page_id IS NULL)
     ORDER BY "order"`,
    [sellerId, productId, pageId]
  );
  return rows;
}

// Todas las imágenes del producto sin importar a qué página pertenezcan — para flujos que
// no son de una página puntual (ej. publicar en Mercado Libre). Se combinan DOS fuentes:
// product_images (fotos del catálogo, las que carga Ventaz, compartidas entre todos los
// vendedores que revenden ese producto) y seller_images (fotos propias que un vendedor
// subió para su propia tienda). Un producto que usa la foto default del catálogo NO tiene
// ninguna fila en seller_images — por eso el fetch anterior (solo seller_images) devolvía
// vacío para la mayoría de los productos, aunque tuvieran foto real en el sistema.
export async function getAllImagesForProduct(sellerId, productId) {
  const { rows } = await pool.query(
    `SELECT key, NULL::uuid AS page_id FROM product_images WHERE product_id = $2
     UNION
     SELECT key, page_id FROM seller_images WHERE seller_id = $1 AND product_id = $2`,
    [sellerId, productId]
  );
  return rows;
}

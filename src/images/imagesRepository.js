// src/modules/images/imagesRepository.js
import pool from "../database/db.js"

export async function countImages(sellerId, productId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) FROM seller_images
     WHERE seller_id = $1 AND product_id = $2`,
    [sellerId, productId]
  );
  return Number(rows[0].count);
}

export async function insertImage(sellerId, productId, key, order) {
  await pool.query(
    `INSERT INTO seller_images (seller_id, product_id, key, "order")
     VALUES ($1, $2, $3, $4)`,
    [sellerId, productId, key, order]
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

export async function getImages(sellerId, productId) {
  const { rows } = await pool.query(
    `SELECT id, key, "order"
     FROM seller_images
     WHERE seller_id = $1 AND product_id = $2
     ORDER BY "order"`,
    [sellerId, productId]
  );
  return rows;
}

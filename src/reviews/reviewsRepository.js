import pool from "../database/db.js";

export async function listByProduct(pageId, productId) {
  const { rows } = await pool.query(
    `SELECT id, author_name, rating, comment, source, published, created_at
     FROM product_reviews
     WHERE page_id = $1 AND product_id = $2
     ORDER BY created_at DESC`,
    [pageId, productId]
  );
  return rows;
}

export async function insertMany(reviews) {
  if (!reviews.length) return;
  const placeholders = reviews.map((_, i) => {
    const b = i * 7;
    return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7})`;
  }).join(",");
  const params = reviews.flatMap(r => [
    r.product_id, r.page_id, r.seller_id,
    r.author_name, r.rating, r.comment, r.source,
  ]);
  await pool.query(
    `INSERT INTO product_reviews
       (product_id, page_id, seller_id, author_name, rating, comment, source)
     VALUES ${placeholders}`,
    params
  );
}

export async function patch(reviewId, pageId, updates) {
  const fields = [];
  const vals   = [];
  let idx = 1;
  if (updates.published !== undefined) {
    fields.push(`published = $${idx++}`);
    vals.push(updates.published);
  }
  if (!fields.length) return null;
  vals.push(reviewId, pageId);
  const { rows } = await pool.query(
    `UPDATE product_reviews
     SET ${fields.join(", ")}
     WHERE id = $${idx++} AND page_id = $${idx++}
     RETURNING *`,
    vals
  );
  return rows[0] || null;
}

export async function remove(reviewId, pageId) {
  await pool.query(
    "DELETE FROM product_reviews WHERE id = $1 AND page_id = $2",
    [reviewId, pageId]
  );
}

export async function publicList(productId, pageId) {
  const { rows } = await pool.query(
    `SELECT author_name, rating, comment, created_at
     FROM product_reviews
     WHERE product_id = $1 AND page_id = $2 AND published = true
     ORDER BY created_at DESC`,
    [productId, pageId]
  );
  return rows;
}

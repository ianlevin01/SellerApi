
import pool from "../database/db.js"

export async function findSellerByEmail(email) {
  const { rows } = await pool.query(
    `SELECT s.*, sp.slug, sp.store_name, sp.pct_markup
     FROM sellers s
     LEFT JOIN seller_pages sp ON sp.seller_id = s.id
     WHERE s.email = $1 AND s.active = true`,
    [email]
  );
  return rows[0] || null;
}

export async function findSellerById(id) {
  const { rows } = await pool.query(
    `SELECT s.id, s.email, s.name, s.phone, s.phone_verified,
            s.city, s.age, s.how_found_us,
            sp.slug, sp.store_name, sp.store_description,
            sp.banner_color, sp.logo_key, sp.pct_markup
     FROM sellers s
     LEFT JOIN seller_pages sp ON sp.seller_id = s.id
     WHERE s.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function updateProfile(id, { name, phone, city, age, how_found_us }) {
  const { rows } = await pool.query(
    `UPDATE sellers
     SET name         = COALESCE($1, name),
         phone        = COALESCE($2, phone),
         city         = COALESCE($3, city),
         age          = COALESCE($4, age),
         how_found_us = COALESCE($5, how_found_us)
     WHERE id = $6
     RETURNING id, email, name, phone, phone_verified, city, age, how_found_us`,
    [name ?? null, phone ?? null, city ?? null, age ?? null, how_found_us ?? null, id]
  );
  return rows[0];
}

export async function saveOtp(sellerId, otp, expiresAt) {
  await pool.query(
    `UPDATE sellers SET phone_otp = $1, phone_otp_expires_at = $2 WHERE id = $3`,
    [otp, expiresAt, sellerId]
  );
}

export async function verifyOtp(sellerId, otp) {
  const { rows } = await pool.query(
    `SELECT phone_otp, phone_otp_expires_at FROM sellers WHERE id = $1`,
    [sellerId]
  );
  const seller = rows[0];
  if (!seller || seller.phone_otp !== otp) return false;
  if (new Date() > new Date(seller.phone_otp_expires_at)) return false;

  await pool.query(
    `UPDATE sellers SET phone_verified = true, phone_otp = NULL, phone_otp_expires_at = NULL WHERE id = $1`,
    [sellerId]
  );
  return true;
}

export async function emailExists(email) {
  const { rows } = await pool.query(
    "SELECT id FROM sellers WHERE email = $1",
    [email]
  );
  return rows.length > 0;
}

export async function createSeller({ email, password_hash, name, phone, verify_token }) {
  const { rows } = await pool.query(
    `INSERT INTO sellers (email, password_hash, name, phone, verify_token)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, name`,
    [email, password_hash, name, phone || null, verify_token]
  );
  return rows[0];
}

export async function createSellerPage({ seller_id, slug, store_name }) {
  await pool.query(
    `INSERT INTO seller_pages (seller_id, slug, store_name) VALUES ($1, $2, $3)`,
    [seller_id, slug, store_name]
  );
}

export async function verifySellerToken(token) {
  const { rows } = await pool.query(
    `UPDATE sellers
     SET verified = true, verify_token = NULL
     WHERE verify_token = $1
     RETURNING id, email, name`,
    [token]
  );
  return rows[0] || null;
}

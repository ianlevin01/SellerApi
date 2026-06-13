
import pool from "../database/db.js"

async function ensureAvatarColumn() {
  await pool.query("ALTER TABLE sellers ADD COLUMN IF NOT EXISTS avatar_key text");
}

async function ensureProfileColumns() {
  await pool.query(`
    ALTER TABLE sellers
      ADD COLUMN IF NOT EXISTS first_name TEXT,
      ADD COLUMN IF NOT EXISTS last_name  TEXT,
      ADD COLUMN IF NOT EXISTS birth_date DATE
  `);
}

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
  await ensureAvatarColumn();
  await ensureProfileColumns();
  const { rows } = await pool.query(
    `SELECT s.id, s.email, s.name, s.first_name, s.last_name, s.phone, s.phone_verified,
            s.city, s.age, s.birth_date, s.how_found_us, s.avatar_key, s.cvu,
            sp.slug, sp.store_name, sp.store_description,
            sp.banner_color, sp.logo_key, sp.pct_markup
     FROM sellers s
     LEFT JOIN seller_pages sp ON sp.seller_id = s.id
     WHERE s.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function updateProfile(id, { name, first_name, last_name, phone, city, age, birth_date, how_found_us }) {
  await ensureAvatarColumn();
  await ensureProfileColumns();
  const { rows } = await pool.query(
    `UPDATE sellers
     SET name         = COALESCE($1, name),
         first_name   = COALESCE($2, first_name),
         last_name    = COALESCE($3, last_name),
         phone        = COALESCE($4, phone),
         city         = COALESCE($5, city),
         age          = COALESCE($6, age),
         birth_date   = COALESCE($7, birth_date),
         how_found_us = COALESCE($8, how_found_us)
     WHERE id = $9
     RETURNING id, email, name, first_name, last_name, phone, phone_verified,
               city, age, birth_date, how_found_us, avatar_key`,
    [name ?? null, first_name ?? null, last_name ?? null,
     phone ?? null, city ?? null, age ?? null,
     birth_date || null, how_found_us ?? null, id]
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

export async function findSellerByGoogleId(googleId) {
  const { rows } = await pool.query(
    `SELECT s.*, sp.slug, sp.store_name, sp.pct_markup
     FROM sellers s
     LEFT JOIN seller_pages sp ON sp.seller_id = s.id
     WHERE s.google_id = $1 AND s.active = true`,
    [googleId]
  );
  return rows[0] || null;
}

export async function linkGoogleId(sellerId, googleId) {
  await pool.query(
    `UPDATE sellers SET google_id = $1 WHERE id = $2`,
    [googleId, sellerId]
  );
}

export async function createSellerWithGoogle({ email, name, google_id }) {
  const { rows } = await pool.query(
    `INSERT INTO sellers (email, name, google_id, verified)
     VALUES ($1, $2, $3, true)
     RETURNING id, email, name`,
    [email, name, google_id]
  );
  return rows[0];
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


export async function saveResetToken(email, token, expiresAt) {
  await pool.query(
    `UPDATE sellers SET reset_token = $1, reset_token_expires_at = $2 WHERE email = $3`,
    [token, expiresAt, email]
  );
}

export async function findSellerByResetToken(token) {
  const { rows } = await pool.query(
    `SELECT id, email, name, reset_token_expires_at
     FROM sellers WHERE reset_token = $1 AND active = true`,
    [token]
  );
  return rows[0] || null;
}

export async function updatePasswordAndClearToken(id, passwordHash) {
  await pool.query(
    `UPDATE sellers
     SET password_hash = $1, reset_token = NULL, reset_token_expires_at = NULL
     WHERE id = $2`,
    [passwordHash, id]
  );
}

export async function updateAvatarKey(id, avatarKey) {
  await ensureAvatarColumn();
  const { rows } = await pool.query(
    `UPDATE sellers
     SET avatar_key = $1
     WHERE id = $2
     RETURNING id, email, name, phone, phone_verified, city, age, how_found_us, avatar_key`,
    [avatarKey, id]
  );
  return rows[0];
}

import pool from "../database/db.js";

export async function findAdminByEmail(email) {
  const { rows } = await pool.query(
    `SELECT id, email, name, password_hash FROM admin_users WHERE email = $1`,
    [email]
  );
  return rows[0] || null;
}

export async function findAdminById(id) {
  const { rows } = await pool.query(
    `SELECT id, email, name, created_at FROM admin_users WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

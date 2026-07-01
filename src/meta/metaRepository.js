import pool from "../database/db.js";

export async function createOAuthState(sellerId) {
  const { rows } = await pool.query(
    `INSERT INTO meta_oauth_states (seller_id) VALUES ($1) RETURNING state`,
    [sellerId]
  );
  return rows[0].state;
}

// Consume el state (lo marca como usado) y retorna el seller_id.
// Falla si ya fue usado o tiene más de 10 minutos.
export async function consumeOAuthState(state) {
  const { rows } = await pool.query(
    `UPDATE meta_oauth_states
     SET used = true
     WHERE state = $1 AND used = false AND created_at > now() - interval '10 minutes'
     RETURNING seller_id`,
    [state]
  );
  return rows[0]?.seller_id || null;
}

export async function upsertConnection(sellerId, { token, expiresAt, metaUserId, metaUserName }) {
  await pool.query(
    `INSERT INTO meta_connections (seller_id, access_token, token_expires_at, meta_user_id, meta_user_name)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (seller_id) DO UPDATE SET
       access_token     = EXCLUDED.access_token,
       token_expires_at = EXCLUDED.token_expires_at,
       meta_user_id     = EXCLUDED.meta_user_id,
       meta_user_name   = EXCLUDED.meta_user_name,
       ad_account_id    = NULL,
       updated_at       = now()`,
    [sellerId, token, expiresAt, metaUserId, metaUserName]
  );
}

export async function getConnection(sellerId) {
  const { rows } = await pool.query(
    `SELECT id, seller_id, token_expires_at, meta_user_id, meta_user_name,
            ad_account_id, ad_account_name, updated_at
     FROM meta_connections WHERE seller_id = $1`,
    [sellerId]
  );
  return rows[0] || null;
}

export async function getConnectionWithToken(sellerId) {
  const { rows } = await pool.query(
    `SELECT * FROM meta_connections WHERE seller_id = $1`,
    [sellerId]
  );
  return rows[0] || null;
}

export async function setAdAccount(sellerId, adAccountId, adAccountName = null) {
  await pool.query(
    `UPDATE meta_connections SET ad_account_id = $1, ad_account_name = $2, updated_at = now() WHERE seller_id = $3`,
    [adAccountId, adAccountName, sellerId]
  );
}

export async function deleteConnection(sellerId) {
  await pool.query(`DELETE FROM meta_connections WHERE seller_id = $1`, [sellerId]);
}

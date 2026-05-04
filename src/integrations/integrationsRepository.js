import pool from "../database/db.js";

export async function listWithStatus(pageId) {
  const { rows } = await pool.query(
    `SELECT i.id, i.key, i.name, i.description, i.icon,
            si.active AS activated, si.config
     FROM integrations i
     LEFT JOIN seller_integrations si ON si.integration_id = i.id AND si.page_id = $1
     WHERE i.active = true
     ORDER BY i.id ASC`,
    [pageId]
  );
  return rows.map(r => ({
    ...r,
    activated: r.activated ?? false,
    config: r.config || {},
  }));
}

export async function toggle(pageId, key, activate) {
  const { rows } = await pool.query(
    `INSERT INTO seller_integrations (page_id, integration_id, active)
     SELECT $1, i.id, $2 FROM integrations i WHERE i.key = $3
     ON CONFLICT (page_id, integration_id) DO UPDATE SET active = EXCLUDED.active
     RETURNING *`,
    [pageId, activate, key]
  );
  return rows[0] || null;
}

export async function updateConfig(pageId, key, config) {
  const { rows } = await pool.query(
    `UPDATE seller_integrations si
     SET config = $3
     FROM integrations i
     WHERE si.integration_id = i.id AND si.page_id = $1 AND i.key = $2
     RETURNING si.*`,
    [pageId, key, JSON.stringify(config)]
  );
  return rows[0] || null;
}

export async function isActive(pageId, key) {
  const { rows } = await pool.query(
    `SELECT 1 FROM seller_integrations si
     JOIN integrations i ON i.id = si.integration_id
     WHERE si.page_id = $1 AND i.key = $2 AND si.active = true`,
    [pageId, key]
  );
  return rows.length > 0;
}

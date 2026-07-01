import pool from "../database/db.js";

// ── Campaigns ─────────────────────────────────────────────────

export async function getCampaigns(sellerId) {
  const { rows } = await pool.query(
    `SELECT c.*, sp.store_name,
       COUNT(cr.id)::int AS creatives_count
     FROM ad_campaigns c
     LEFT JOIN seller_pages sp ON sp.id = c.page_id
     LEFT JOIN ad_creatives cr ON cr.campaign_id = c.id
     WHERE c.seller_id = $1
     GROUP BY c.id, sp.store_name
     ORDER BY c.created_at DESC`,
    [sellerId]
  );
  return rows;
}

export async function getCampaign(id, sellerId) {
  const { rows } = await pool.query(
    `SELECT c.*, sp.store_name FROM ad_campaigns c
     LEFT JOIN seller_pages sp ON sp.id = c.page_id
     WHERE c.id = $1 AND c.seller_id = $2`,
    [id, sellerId]
  );
  return rows[0] || null;
}

export async function createCampaign(sellerId, data) {
  const { name, objective = "sales", status = "draft", daily_budget, start_date, end_date, page_id, notes } = data;
  const { rows } = await pool.query(
    `INSERT INTO ad_campaigns (seller_id, page_id, name, objective, status, daily_budget, start_date, end_date, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [sellerId, page_id || null, name, objective, status, daily_budget || null, start_date || null, end_date || null, notes || null]
  );
  return rows[0];
}

export async function updateCampaign(id, sellerId, data) {
  const { name, objective, status, daily_budget, start_date, end_date, page_id, notes } = data;
  const { rows } = await pool.query(
    `UPDATE ad_campaigns
     SET name=$3, objective=$4, status=$5, daily_budget=$6, start_date=$7, end_date=$8, page_id=$9, notes=$10, updated_at=NOW()
     WHERE id=$1 AND seller_id=$2
     RETURNING *`,
    [id, sellerId, name, objective, status, daily_budget || null, start_date || null, end_date || null, page_id || null, notes || null]
  );
  return rows[0] || null;
}

export async function deleteCampaign(id, sellerId) {
  await pool.query("DELETE FROM ad_campaigns WHERE id=$1 AND seller_id=$2", [id, sellerId]);
}

// ── Creatives ─────────────────────────────────────────────────

export async function getCreatives(campaignId, sellerId) {
  const { rows } = await pool.query(
    `SELECT cr.*, COALESCE(sp.custom_name, p.name) AS product_name
     FROM ad_creatives cr
     LEFT JOIN products p ON p.id = cr.product_id
     LEFT JOIN seller_products sp ON sp.product_id = cr.product_id AND sp.seller_id = $2
     WHERE cr.campaign_id = $1
     ORDER BY cr.created_at DESC`,
    [campaignId, sellerId]
  );
  return rows;
}

export async function createCreative(campaignId, sellerId, data) {
  const { product_id, headline, primary_text, description, cta = "Comprar ahora", format = "feed", variant = "A", notes, image_url, image_prompt } = data;
  const { rows } = await pool.query(
    `INSERT INTO ad_creatives (campaign_id, seller_id, product_id, headline, primary_text, description, cta, format, variant, notes, image_url, image_prompt)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [campaignId, sellerId, product_id || null, headline || null, primary_text || null, description || null, cta, format, variant, notes || null, image_url || null, image_prompt || null]
  );
  return rows[0];
}

export async function updateCreative(id, sellerId, data) {
  const { headline, primary_text, description, cta, format, variant, notes, image_url, image_prompt } = data;
  const { rows } = await pool.query(
    `UPDATE ad_creatives
     SET headline=$3, primary_text=$4, description=$5, cta=$6, format=$7, variant=$8, notes=$9,
         image_url=$10, image_prompt=$11, updated_at=NOW()
     WHERE id=$1 AND seller_id=$2
     RETURNING *`,
    [id, sellerId, headline || null, primary_text || null, description || null, cta || "Comprar ahora", format || "feed", variant || "A", notes || null, image_url || null, image_prompt || null]
  );
  return rows[0] || null;
}

export async function deleteCreative(id, sellerId) {
  await pool.query("DELETE FROM ad_creatives WHERE id=$1 AND seller_id=$2", [id, sellerId]);
}

// ── For agent context ─────────────────────────────────────────

export async function getCampaignsWithCreatives(sellerId) {
  const { rows: campaigns } = await pool.query(
    `SELECT c.*, sp.store_name,
       COUNT(cr.id)::int AS creatives_count,
       SUM(c.daily_budget)::numeric AS total_daily_budget
     FROM ad_campaigns c
     LEFT JOIN seller_pages sp ON sp.id = c.page_id
     LEFT JOIN ad_creatives cr ON cr.campaign_id = c.id
     WHERE c.seller_id = $1
     GROUP BY c.id, sp.store_name
     ORDER BY c.created_at DESC`,
    [sellerId]
  );

  const { rows: creatives } = await pool.query(
    `SELECT cr.*, COALESCE(sp.custom_name, p.name) AS product_name
     FROM ad_creatives cr
     LEFT JOIN products p ON p.id = cr.product_id
     LEFT JOIN seller_products sp ON sp.product_id = cr.product_id AND sp.seller_id = $1
     WHERE cr.seller_id = $1
     ORDER BY cr.created_at DESC`,
    [sellerId]
  );

  return { campaigns, creatives };
}

import pool from "../database/db.js";

export async function getOnboardingProgress(sellerId) {
  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*) >= 1 FROM seller_pages WHERE seller_id = $1)
         AS create_page,

       (SELECT COUNT(*) >= 5 FROM seller_products WHERE seller_id = $1 AND active = true)
         AS add_5_products,

       (SELECT COUNT(*) >= 3 FROM seller_products
        WHERE seller_id = $1 AND custom_price IS NOT NULL AND active = true)
         AS set_custom_prices,

       (SELECT EXISTS(SELECT 1 FROM seller_discount_tiers WHERE seller_id = $1))
         AS create_discount,

       (SELECT COUNT(*) >= 1 FROM page_combos WHERE seller_id = $1 AND active = true)
         AS add_combo,

       COALESCE((
         SELECT (phone IS NOT NULL AND avatar_key IS NOT NULL AND cvu IS NOT NULL)
         FROM sellers WHERE id = $1
       ), false)
         AS complete_profile,

       (SELECT EXISTS(
         SELECT 1 FROM seller_pages sp
         JOIN seller_integrations si ON si.page_id = sp.id
         WHERE sp.seller_id = $1 AND si.active = true
       ))
         AS add_integration,

       (SELECT EXISTS(SELECT 1 FROM web_orders WHERE seller_id = $1 AND color = 'paid'))
         AS first_sale,

       (SELECT EXISTS(SELECT 1 FROM seller_payouts WHERE seller_id = $1))
         AS request_payout,

       (SELECT onboarding_dismissed_at IS NOT NULL FROM sellers WHERE id = $1)
         AS dismissed,

       (SELECT id FROM seller_pages WHERE seller_id = $1 ORDER BY created_at ASC LIMIT 1)
         AS suggested_page_id`,
    [sellerId]
  );
  return rows[0] || {};
}

export async function dismissOnboarding(sellerId) {
  await pool.query(
    `UPDATE sellers SET onboarding_dismissed_at = NOW() WHERE id = $1`,
    [sellerId]
  );
}

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

// Progreso de onboarding para el track de Mercado Libre — no usa Cobros/payouts porque en
// ese flujo el vendedor cobra directo en su propia cuenta de MP (ver mlWalletService.js).
export async function getOnboardingProgressMl(sellerId) {
  const { rows } = await pool.query(
    `SELECT
       (SELECT EXISTS(SELECT 1 FROM ml_connections WHERE seller_id = $1 AND ml_user_id IS NOT NULL))
         AS connect_ml,

       (SELECT EXISTS(SELECT 1 FROM ml_connections WHERE seller_id = $1 AND mp_card_id IS NOT NULL))
         AS save_card,

       (SELECT COUNT(*) >= 1 FROM ml_listings WHERE seller_id = $1)
         AS first_listing,

       COALESCE((
         SELECT (phone IS NOT NULL AND avatar_key IS NOT NULL)
         FROM sellers WHERE id = $1
       ), false)
         AS complete_profile,

       (SELECT EXISTS(SELECT 1 FROM web_orders WHERE seller_id = $1 AND channel = 'mercadolibre'))
         AS first_sale_ml,

       (SELECT onboarding_dismissed_at IS NOT NULL FROM sellers WHERE id = $1)
         AS dismissed`,
    [sellerId]
  );
  return rows[0] || {};
}

// El JWT del seller no lleva onboarding_track (se firmó en el login, y esto puede cambiar
// después) — hay que consultarlo fresco en vez de confiar en el token.
export async function getSellerOnboardingTrack(sellerId) {
  const { rows } = await pool.query(`SELECT onboarding_track FROM sellers WHERE id = $1`, [sellerId]);
  return rows[0]?.onboarding_track || null;
}

export async function setOnboardingTrack(sellerId, track) {
  const { rows } = await pool.query(
    `UPDATE sellers SET onboarding_track = $1 WHERE id = $2 RETURNING id, onboarding_track`,
    [track, sellerId]
  );
  return rows[0] || null;
}

export async function setHasSoldOnMlBefore(sellerId, soldBefore) {
  const { rows } = await pool.query(
    `UPDATE sellers SET has_sold_on_ml_before = $1 WHERE id = $2 RETURNING id, has_sold_on_ml_before`,
    [soldBefore, sellerId]
  );
  return rows[0] || null;
}

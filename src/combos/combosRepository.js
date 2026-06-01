import pool from "../database/db.js";

export async function findByPage(pageId, sellerId) {
  const { rows } = await pool.query(`
    SELECT
      c.id, c.name, c.description, c.custom_price, c.promo_price, c.promo_enabled, c.free_shipping, c.active, c.created_at,
      COALESCE(
        (SELECT json_agg(json_build_object(
           'product_id', cp.product_id,
           'quantity',   cp.quantity,
           'name',       p.name,
           'code',       p.code,
           'cost_usd',   COALESCE(p.costo_usd, 0)
         ) ORDER BY cp.id)
         FROM combo_products cp
         JOIN products p ON p.id = cp.product_id
         WHERE cp.combo_id = c.id), '[]'
      ) AS products,
      COALESCE(
        (SELECT json_agg(ci.key ORDER BY ci."order")
         FROM combo_images ci WHERE ci.combo_id = c.id), '[]'
      ) AS image_keys
    FROM page_combos c
    WHERE c.page_id = $1 AND c.seller_id = $2
    ORDER BY c.created_at DESC
  `, [pageId, sellerId]);
  return rows;
}

export async function findPublicByPage(pageId) {
  const { rows } = await pool.query(`
    SELECT
      c.id, c.name, c.description, c.custom_price, c.promo_price, c.promo_enabled, c.free_shipping,
      COALESCE(
        (SELECT json_agg(json_build_object(
           'product_id', cp.product_id,
           'quantity',   cp.quantity,
           'name',       p.name,
           'code',       p.code,
           'system_images', (
             SELECT COALESCE(json_agg(pi.key ORDER BY pi.created_at), '[]')
             FROM product_images pi WHERE pi.product_id = p.id
           )
         ) ORDER BY cp.id)
         FROM combo_products cp
         JOIN products p ON p.id = cp.product_id
         WHERE cp.combo_id = c.id), '[]'
      ) AS products,
      COALESCE(
        (SELECT json_agg(ci.key ORDER BY ci."order")
         FROM combo_images ci WHERE ci.combo_id = c.id), '[]'
      ) AS image_keys
    FROM page_combos c
    WHERE c.page_id = $1 AND c.active = true
    ORDER BY c.created_at DESC
  `, [pageId]);
  return rows;
}

export async function create(pageId, sellerId, { name, description, custom_price, products }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO page_combos (page_id, seller_id, name, description, custom_price)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [pageId, sellerId, name, description || null, custom_price || 0]
    );
    const comboId = rows[0].id;
    for (const p of (products || [])) {
      await client.query(
        `INSERT INTO combo_products (combo_id, product_id, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (combo_id, product_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
        [comboId, p.product_id, p.quantity || 1]
      );
    }
    await client.query("COMMIT");
    return comboId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function update(comboId, sellerId, { name, description, custom_price, active, free_shipping, promo_price, promo_enabled, products }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE page_combos SET
         name          = COALESCE($1, name),
         description   = $2,
         custom_price  = COALESCE($3, custom_price),
         active        = COALESCE($4, active),
         free_shipping = COALESCE($5, free_shipping),
         promo_price   = $8,
         promo_enabled = COALESCE($9, promo_enabled),
         updated_at    = now()
       WHERE id = $6 AND seller_id = $7`,
      [name, description !== undefined ? description : null, custom_price, active,
       free_shipping !== undefined ? free_shipping : null, comboId, sellerId,
       promo_price !== undefined ? promo_price : null,
       promo_enabled !== undefined ? promo_enabled : null]
    );
    if (products !== undefined) {
      await client.query(`DELETE FROM combo_products WHERE combo_id = $1`, [comboId]);
      for (const p of products) {
        await client.query(
          `INSERT INTO combo_products (combo_id, product_id, quantity) VALUES ($1, $2, $3)`,
          [comboId, p.product_id, p.quantity || 1]
        );
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function remove(comboId, sellerId) {
  await pool.query(
    `DELETE FROM page_combos WHERE id = $1 AND seller_id = $2`,
    [comboId, sellerId]
  );
}

export async function findById(comboId, sellerId) {
  const { rows } = await pool.query(`
    SELECT
      c.id, c.name, c.description, c.custom_price, c.promo_price, c.promo_enabled, c.free_shipping, c.active, c.created_at,
      COALESCE(
        (SELECT json_agg(json_build_object(
           'product_id', cp.product_id,
           'quantity',   cp.quantity,
           'name',       p.name,
           'code',       p.code
         ) ORDER BY cp.id)
         FROM combo_products cp
         JOIN products p ON p.id = cp.product_id
         WHERE cp.combo_id = c.id), '[]'
      ) AS products,
      COALESCE(
        (SELECT json_agg(ci.key ORDER BY ci."order")
         FROM combo_images ci WHERE ci.combo_id = c.id), '[]'
      ) AS image_keys
    FROM page_combos c
    WHERE c.id = $1 AND c.seller_id = $2
  `, [comboId, sellerId]);
  return rows[0] || null;
}

export async function getComboTotalCostUsd(comboId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(p.costo_usd * cp.quantity), 0) AS total_cost_usd
     FROM combo_products cp
     JOIN products p ON p.id = cp.product_id
     WHERE cp.combo_id = $1`,
    [comboId]
  );
  return Number(rows[0]?.total_cost_usd || 0);
}

export async function isOwned(comboId, sellerId) {
  const { rows } = await pool.query(
    `SELECT id FROM page_combos WHERE id = $1 AND seller_id = $2`,
    [comboId, sellerId]
  );
  return rows.length > 0;
}

export async function addImage(comboId, sellerId, key) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) FROM combo_images WHERE combo_id = $1`,
    [comboId]
  );
  const order = Number(rows[0].count);
  await pool.query(
    `INSERT INTO combo_images (combo_id, seller_id, key, "order") VALUES ($1, $2, $3, $4)`,
    [comboId, sellerId, key, order]
  );
}

export async function removeImage(comboId, key) {
  await pool.query(
    `DELETE FROM combo_images WHERE combo_id = $1 AND key = $2`,
    [comboId, key]
  );
}

export async function getImages(comboId) {
  const { rows } = await pool.query(
    `SELECT key FROM combo_images WHERE combo_id = $1 ORDER BY "order"`,
    [comboId]
  );
  return rows.map(r => r.key);
}

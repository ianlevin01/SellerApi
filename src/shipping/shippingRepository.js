import pool from "../database/db.js";

export async function saveOrderShipping(webOrderId, shipping, trackingCode = null) {
  const { rows } = await pool.query(
    `INSERT INTO order_shipping
       (web_order_id, shipping_type, postal_code, province,
        street, street_number, floor_apt, city,
        branch_id, branch_name,
        service_code, service_name, shipping_amount, tracking_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      webOrderId,
      shipping.type            || "home",
      shipping.postal_code     || null,
      shipping.province        || null,
      shipping.street          || null,
      shipping.street_number   || null,
      shipping.floor_apt       || null,
      shipping.city            || null,
      shipping.branch_id       || null,
      shipping.branch_name     || null,
      shipping.service_code    || null,
      shipping.service_name    || null,
      Number(shipping.amount   || 0),
      trackingCode,
    ]
  );
  return rows[0];
}

export async function getOrderShipping(webOrderId) {
  const { rows } = await pool.query(
    `SELECT * FROM order_shipping WHERE web_order_id = $1`,
    [webOrderId]
  );
  return rows[0] || null;
}

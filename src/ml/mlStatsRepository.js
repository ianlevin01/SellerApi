// src/ml/mlStatsRepository.js
// Estadísticas de Mercado Libre — todo se calcula con datos que ya guardamos en
// web_orders/web_order_items, sin pegarle a la API de ML en cada carga de la pantalla.
import pool from "../database/db.js";

const ART = "America/Argentina/Buenos_Aires";
// Estados que representan una venta real y confirmada (después de pagada) — "pending" todavía
// no cobró, "cancelled"/"rejected"/"refunded" no son facturación real.
const CONFIRMED = ["paid", "packaged", "shipped"];

// KPIs de un período — se llama dos veces (período actual y el anterior de igual duración)
// para poder calcular el % de crecimiento sin duplicar la consulta.
export async function getKpis(sellerId, from, to) {
  // Agregados a nivel de pedido (revenue/orders/devoluciones/compradores) — sin join a items,
  // para no duplicar wo.total por cada ítem que tenga el pedido.
  const { rows: orderRows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE color = ANY($3))::int AS orders,
       COALESCE(SUM(total) FILTER (WHERE color = ANY($3)), 0)::numeric AS revenue,
       COALESCE(SUM(ml_cost_amount) FILTER (WHERE color = ANY($3)), 0)::numeric AS cost_total,
       COUNT(*) FILTER (WHERE color = 'refunded')::int AS refunded_count,
       COUNT(*) FILTER (WHERE color IN ('cancelled', 'rejected'))::int AS cancelled_count,
       COUNT(*)::int AS total_orders_any_status,
       COUNT(DISTINCT customer_email) FILTER (WHERE color = ANY($3) AND customer_email IS NOT NULL)::int AS unique_buyers
     FROM web_orders
     WHERE seller_id = $4 AND channel = 'mercadolibre'
       AND (created_at AT TIME ZONE '${ART}')::date BETWEEN $1 AND $2`,
    [from, to, CONFIRMED, sellerId]
  );

  // Unidades — sí necesita el join a items, es una suma que no duplica nada al hacerlo.
  const { rows: unitRows } = await pool.query(
    `SELECT COALESCE(SUM(woi.quantity), 0)::int AS units
     FROM web_order_items woi
     JOIN web_orders wo ON wo.id = woi.web_order_id
     WHERE wo.seller_id = $4 AND wo.channel = 'mercadolibre'
       AND (wo.created_at AT TIME ZONE '${ART}')::date BETWEEN $1 AND $2 AND wo.color = ANY($3)`,
    [from, to, CONFIRMED, sellerId]
  );

  const r = orderRows[0] || {};
  return {
    orders: Number(r.orders || 0),
    revenue: Number(r.revenue || 0),
    units: Number(unitRows[0]?.units || 0),
    costTotal: Number(r.cost_total || 0),
    refundedCount: Number(r.refunded_count || 0),
    cancelledCount: Number(r.cancelled_count || 0),
    totalOrdersAnyStatus: Number(r.total_orders_any_status || 0),
    uniqueBuyers: Number(r.unique_buyers || 0),
  };
}

// Serie temporal — agrupación configurable. "hour" agrupa por hora del día (0-23), sumando
// todos los días del período (para detectar en qué horario venden más, no una serie por fecha).
export async function getTimeSeries(sellerId, from, to, groupBy = "day") {
  let bucketExpr;
  if (groupBy === "hour") {
    bucketExpr = `EXTRACT(HOUR FROM wo.created_at AT TIME ZONE '${ART}')::int`;
  } else if (groupBy === "week") {
    bucketExpr = `date_trunc('week', wo.created_at AT TIME ZONE '${ART}')::date::text`;
  } else if (groupBy === "month") {
    bucketExpr = `date_trunc('month', wo.created_at AT TIME ZONE '${ART}')::date::text`;
  } else {
    bucketExpr = `(wo.created_at AT TIME ZONE '${ART}')::date::text`;
  }
  const { rows } = await pool.query(
    `SELECT ${bucketExpr} AS bucket,
       COUNT(DISTINCT wo.id)::int AS orders,
       COALESCE(SUM(wo.total), 0)::numeric AS revenue
     FROM web_orders wo
     WHERE wo.seller_id = $1 AND wo.channel = 'mercadolibre'
       AND (wo.created_at AT TIME ZONE '${ART}')::date BETWEEN $2 AND $3 AND wo.color = ANY($4)
     GROUP BY bucket
     ORDER BY bucket`,
    [sellerId, from, to, CONFIRMED]
  );
  return rows.map(r => ({ bucket: groupBy === "hour" ? Number(r.bucket) : r.bucket, orders: Number(r.orders), revenue: Number(r.revenue) }));
}

// Mapa de calor día de semana (0=domingo) × hora — cuenta de pedidos, para detectar franjas
// horarias de mayor conversión. Usa la misma zona horaria que el resto de las estadísticas.
export async function getHeatmap(sellerId, from, to) {
  const { rows } = await pool.query(
    `SELECT
       EXTRACT(DOW  FROM wo.created_at AT TIME ZONE '${ART}')::int AS dow,
       EXTRACT(HOUR FROM wo.created_at AT TIME ZONE '${ART}')::int AS hour,
       COUNT(*)::int AS orders
     FROM web_orders wo
     WHERE wo.seller_id = $1 AND wo.channel = 'mercadolibre'
       AND (wo.created_at AT TIME ZONE '${ART}')::date BETWEEN $2 AND $3 AND wo.color = ANY($4)
     GROUP BY dow, hour`,
    [sellerId, from, to, CONFIRMED]
  );
  return rows.map(r => ({ dow: Number(r.dow), hour: Number(r.hour), orders: Number(r.orders) }));
}

// Tabla de productos vendidos en el período — une con ml_listings para traer stock/precio
// actual e imagen, sin pedirle nada nuevo a la API de ML. La imagen no es una columna de
// ml_listings (no existe ahí) — se resuelve igual que en mlRepository.getListingsBySeller,
// tomando la más vieja de product_images para ese producto. Viaja como key cruda (S3) y se
// firma a URL recién en mlStatsService (la firma es async, no se puede hacer en el SELECT).
export async function getProductBreakdown(sellerId, from, to) {
  const { rows } = await pool.query(
    `SELECT
       woi.product_id,
       COALESCE(p.name, woi.name) AS name,
       p.code AS sku,
       SUM(woi.quantity)::int AS units,
       SUM(woi.quantity * woi.unit_price)::numeric AS revenue,
       l.price AS current_price,
       l.status AS listing_status,
       (SELECT key FROM product_images WHERE product_id = p.id ORDER BY created_at LIMIT 1) AS image_key,
       GREATEST(0, COALESCE(
         (SELECT SUM(s.quantity) FROM stock s WHERE s.product_id = p.id), 0
       ) - COALESCE(p.stock_reserva, 0)) AS current_stock
     FROM web_order_items woi
     JOIN web_orders wo ON wo.id = woi.web_order_id
     LEFT JOIN products p ON p.id = woi.product_id
     LEFT JOIN ml_listings l ON l.product_id = woi.product_id AND l.seller_id = $1
     WHERE wo.seller_id = $1 AND wo.channel = 'mercadolibre'
       AND (wo.created_at AT TIME ZONE '${ART}')::date BETWEEN $2 AND $3 AND wo.color = ANY($4)
       AND woi.product_id IS NOT NULL
     GROUP BY woi.product_id, p.name, woi.name, p.code, p.stock_reserva, p.id, l.price, l.status
     ORDER BY revenue DESC`,
    [sellerId, from, to, CONFIRMED]
  );
  return rows.map(r => ({
    productId: r.product_id, name: r.name, sku: r.sku,
    units: Number(r.units), revenue: Number(r.revenue),
    currentPrice: r.current_price != null ? Number(r.current_price) : null,
    listingStatus: r.listing_status, currentStock: r.current_stock != null ? Number(r.current_stock) : null,
    imageKey: r.image_key,
  }));
}

// Provincias del comprador — requiere que mlWebhookController ya haya guardado
// ml_receiver_province (ver migración de columnas nuevas). Órdenes viejas sin ese dato
// simplemente no entran en el agrupamiento (no hay forma de recuperarlas retroactivamente
// sin volver a pedirle el envío a la API de ML una por una).
export async function getProvinceBreakdown(sellerId, from, to) {
  const { rows } = await pool.query(
    `SELECT wo.ml_receiver_province AS province,
       COUNT(DISTINCT wo.id)::int AS orders,
       COALESCE(SUM(wo.total), 0)::numeric AS revenue
     FROM web_orders wo
     WHERE wo.seller_id = $1 AND wo.channel = 'mercadolibre'
       AND (wo.created_at AT TIME ZONE '${ART}')::date BETWEEN $2 AND $3 AND wo.color = ANY($4)
       AND wo.ml_receiver_province IS NOT NULL
     GROUP BY wo.ml_receiver_province
     ORDER BY revenue DESC`,
    [sellerId, from, to, CONFIRMED]
  );
  return rows.map(r => ({ province: r.province, orders: Number(r.orders), revenue: Number(r.revenue) }));
}

// Método de envío (Correo/Flex, según ml_logistic_type) + tiempo promedio despacho→entrega,
// solo sobre los pedidos que ya tienen ambas fechas cargadas.
export async function getShippingBreakdown(sellerId, from, to) {
  const { rows } = await pool.query(
    `SELECT
       CASE WHEN wo.ml_logistic_type = 'self_service' THEN 'Flex'
            WHEN wo.ml_logistic_type = 'fulfillment'   THEN 'Full'
            WHEN wo.ml_logistic_type IS NOT NULL       THEN 'Correo'
            ELSE 'Sin datos' END AS method,
       COUNT(DISTINCT wo.id)::int AS orders,
       AVG(EXTRACT(EPOCH FROM (wo.ml_delivered_at - wo.ml_date_shipped)) / 3600)
         FILTER (WHERE wo.ml_delivered_at IS NOT NULL AND wo.ml_date_shipped IS NOT NULL) AS avg_delivery_hours
     FROM web_orders wo
     WHERE wo.seller_id = $1 AND wo.channel = 'mercadolibre'
       AND (wo.created_at AT TIME ZONE '${ART}')::date BETWEEN $2 AND $3 AND wo.color = ANY($4)
     GROUP BY method
     ORDER BY orders DESC`,
    [sellerId, from, to, CONFIRMED]
  );
  return rows.map(r => ({
    method: r.method, orders: Number(r.orders),
    avgDeliveryHours: r.avg_delivery_hours != null ? Math.round(Number(r.avg_delivery_hours) * 10) / 10 : null,
  }));
}

// Backfill liviano: para pedidos recientes que ya tienen shipment_id pero no provincia/entrega
// (creados antes de esta feature), completa esos datos pidiéndole el shipment a la API de ML —
// mismo patrón de "completar al leer" que ya usa adminService.backfillMissingShipmentInfo.
// Acotado a un puñado de filas por carga para no demorar la pantalla ni saturar la API de ML.
export async function getOrdersMissingGeoData(sellerId, from, to, limit = 40) {
  const { rows } = await pool.query(
    `SELECT id, ml_shipment_id
     FROM web_orders
     WHERE seller_id = $1 AND channel = 'mercadolibre'
       AND (created_at AT TIME ZONE '${ART}')::date BETWEEN $2 AND $3
       AND ml_shipment_id IS NOT NULL AND ml_receiver_province IS NULL
     ORDER BY created_at DESC
     LIMIT $4`,
    [sellerId, from, to, limit]
  );
  return rows;
}

export async function setOrderGeoAndDelivery(orderId, { province, city, deliveredAt }) {
  await pool.query(
    `UPDATE web_orders SET ml_receiver_province = COALESCE(ml_receiver_province, $1),
       ml_receiver_city = COALESCE(ml_receiver_city, $2), ml_delivered_at = COALESCE(ml_delivered_at, $3)
     WHERE id = $4`,
    [province, city, deliveredAt, orderId]
  );
}

// Objetivo mensual que el vendedor define — un solo valor por vendedor+mes, no depende de ML.
export async function getMonthlyGoal(sellerId, monthKey) {
  const { rows } = await pool.query(
    `SELECT revenue_goal FROM ml_monthly_goals WHERE seller_id = $1 AND month_key = $2`,
    [sellerId, monthKey]
  );
  return rows[0]?.revenue_goal != null ? Number(rows[0].revenue_goal) : null;
}

export async function setMonthlyGoal(sellerId, monthKey, revenueGoal) {
  await pool.query(
    `INSERT INTO ml_monthly_goals (seller_id, month_key, revenue_goal)
     VALUES ($1, $2, $3)
     ON CONFLICT (seller_id, month_key) DO UPDATE SET revenue_goal = $3, updated_at = now()`,
    [sellerId, monthKey, revenueGoal]
  );
}

// src/store/analyticsRepository.js
import pool from "../database/db.js";

/**
 * Incrementa (o crea) el contador de visitas del día para una tienda.
 * Se llama desde la tienda pública sin autenticación.
 */
export async function incrementVisit(slug) {
  await pool.query(`
    INSERT INTO store_analytics_daily (page_id, date, visits)
    SELECT sp.id, CURRENT_DATE, 1
    FROM seller_pages sp
    WHERE sp.slug = $1 AND sp.active = true
    ON CONFLICT (page_id, date)
    DO UPDATE SET visits = store_analytics_daily.visits + 1
  `, [slug]);
}

/**
 * Devuelve visitas y pedidos por día para una página.
 * Valida que el seller sea dueño de esa página.
 */
export async function getAnalytics(pageId, sellerId, from, to) {
  // Verificar propiedad
  const { rows: pageRows } = await pool.query(
    `SELECT id FROM seller_pages WHERE id = $1 AND seller_id = $2`,
    [pageId, sellerId]
  );
  if (!pageRows.length) {
    const err = new Error("Página no encontrada");
    err.status = 404;
    throw err;
  }

  // Visitas por día
  const { rows: visitRows } = await pool.query(`
    SELECT date::text, visits AS count
    FROM store_analytics_daily
    WHERE page_id = $1 AND date BETWEEN $2 AND $3
    ORDER BY date
  `, [pageId, from, to]);

  // Pedidos por día (con revenue)
  const { rows: orderRows } = await pool.query(`
    SELECT
      DATE(wo.created_at)::text AS date,
      COUNT(*)::int              AS count,
      COALESCE(SUM(wo.total), 0)::numeric AS revenue
    FROM web_orders wo
    WHERE wo.seller_id = $1
      AND DATE(wo.created_at) BETWEEN $2 AND $3
      AND wo.color IN ('paid', 'pending')
    GROUP BY DATE(wo.created_at)
    ORDER BY DATE(wo.created_at)
  `, [sellerId, from, to]);

  // Totales del período
  const totalVisits  = visitRows.reduce((s, r) => s + Number(r.count), 0);
  const totalOrders  = orderRows.reduce((s, r) => s + Number(r.count), 0);
  const totalRevenue = orderRows.reduce((s, r) => s + Number(r.revenue), 0);

  return {
    visits:       visitRows.map(r => ({ date: r.date, count: Number(r.count) })),
    orders:       orderRows.map(r => ({ date: r.date, count: Number(r.count), revenue: Number(r.revenue) })),
    totals: {
      visits:     totalVisits,
      orders:     totalOrders,
      revenue:    totalRevenue,
      conversion: totalVisits > 0 ? Math.round((totalOrders / totalVisits) * 1000) / 10 : 0,
    },
  };
}

// src/store/analyticsRepository.js
import pool from "../database/db.js";

const ART = "America/Argentina/Buenos_Aires";

export async function incrementVisit(slug) {
  await pool.query(`
    INSERT INTO store_analytics_daily (page_id, date, visits)
    SELECT sp.id, (NOW() AT TIME ZONE '${ART}')::date, 1
    FROM seller_pages sp
    WHERE sp.slug = $1 AND sp.active = true
    ON CONFLICT (page_id, date)
    DO UPDATE SET visits = store_analytics_daily.visits + 1
  `, [slug]);
}

export async function incrementCart(slug) {
  await pool.query(`
    INSERT INTO store_analytics_daily (page_id, date, carts)
    SELECT sp.id, (NOW() AT TIME ZONE '${ART}')::date, 1
    FROM seller_pages sp
    WHERE sp.slug = $1 AND sp.active = true
    ON CONFLICT (page_id, date)
    DO UPDATE SET carts = store_analytics_daily.carts + 1
  `, [slug]);
}

async function _analyticsQuery(pageId, sellerId, from, to) {
  // Sin pageId (seller sin tienda web, ej. solo vende por Mercado Libre) no hay
  // visitas/carritos que mostrar — solo pedidos, que ya son seller-scoped.
  const visitRows = pageId
    ? (await pool.query(`
        SELECT date::text, visits AS count, carts
        FROM store_analytics_daily
        WHERE page_id = $1 AND date BETWEEN $2 AND $3
        ORDER BY date
      `, [pageId, from, to])).rows
    : [];

  const { rows: orderRows } = await pool.query(`
    SELECT
      (wo.created_at AT TIME ZONE '${ART}')::date::text AS date,
      COUNT(*)::int              AS count,
      COALESCE(SUM(wo.total), 0)::numeric AS revenue
    FROM web_orders wo
    WHERE wo.seller_id = $1
      AND (wo.created_at AT TIME ZONE '${ART}')::date BETWEEN $2 AND $3
      AND wo.color IN ('paid', 'pending')
    GROUP BY (wo.created_at AT TIME ZONE '${ART}')::date
    ORDER BY (wo.created_at AT TIME ZONE '${ART}')::date
  `, [sellerId, from, to]);

  const totalVisits  = visitRows.reduce((s, r) => s + Number(r.count), 0);
  const totalCarts   = visitRows.reduce((s, r) => s + Number(r.carts || 0), 0);
  const totalOrders  = orderRows.reduce((s, r) => s + Number(r.count), 0);
  const totalRevenue = orderRows.reduce((s, r) => s + Number(r.revenue), 0);

  return {
    visits: visitRows.map(r => ({ date: r.date, count: Number(r.count), carts: Number(r.carts || 0) })),
    orders: orderRows.map(r => ({ date: r.date, count: Number(r.count), revenue: Number(r.revenue) })),
    totals: {
      visits:     totalVisits,
      carts:      totalCarts,
      orders:     totalOrders,
      revenue:    totalRevenue,
      conversion: totalVisits > 0 ? Math.round((totalOrders / totalVisits) * 1000) / 10 : 0,
      cart_rate:  totalVisits > 0 ? Math.round((totalCarts / totalVisits) * 1000) / 10 : 0,
    },
  };
}

// Admin: no ownership check, looks up seller_id from the page row.
export async function getAnalyticsAdmin(pageId, from, to) {
  const { rows } = await pool.query(
    `SELECT id, seller_id FROM seller_pages WHERE id = $1`, [pageId]
  );
  if (!rows.length) { const e = new Error("Página no encontrada"); e.status = 404; throw e; }
  return _analyticsQuery(pageId, rows[0].seller_id, from, to);
}

// Seller: verifies ownership before returning data.
export async function getAnalytics(pageId, sellerId, from, to) {
  const { rows } = await pool.query(
    `SELECT id FROM seller_pages WHERE id = $1 AND seller_id = $2`, [pageId, sellerId]
  );
  if (!rows.length) { const e = new Error("Página no encontrada"); e.status = 404; throw e; }
  return _analyticsQuery(pageId, sellerId, from, to);
}

// Modo "Todos los canales" — sin pageId, agrega los pedidos del seller sin importar
// si tiene tienda web o no (necesario para un seller que solo vende por Mercado Libre).
export async function getAnalyticsAllChannels(sellerId, from, to) {
  return _analyticsQuery(null, sellerId, from, to);
}

import pool from "../database/db.js";
import { signKey } from "../utils/s3Client.js";

const PLAN_ORDER = { inicial: 1, pro: 2, max: 3 };

// Si el valor es una key de S3 (no empieza con http), la firma; si no, la devuelve tal cual
async function resolveThumb(raw) {
  if (!raw) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  return signKey(raw);
}

export async function getCourses(sellerId, sellerPlanId = "inicial") {
  const { rows } = await pool.query(
    `SELECT c.*,
            COUNT(s.id) AS section_count,
            COUNT(p.section_id) AS completed_count
     FROM academy_courses c
     LEFT JOIN academy_sections s ON s.course_id = c.id
     LEFT JOIN academy_progress p ON p.section_id = s.id AND p.seller_id = $1
     WHERE c.published = true
     GROUP BY c.id
     ORDER BY c.sort_order ASC, c.created_at ASC`,
    [sellerId]
  );
  const sellerOrder = PLAN_ORDER[sellerPlanId] ?? 1;
  return Promise.all(rows.map(async r => {
    const minOrder = PLAN_ORDER[r.min_plan || "inicial"] ?? 1;
    const locked   = sellerOrder < minOrder;
    return {
      ...r,
      thumbnail_url:   await resolveThumb(r.thumbnail_url),
      section_count:   Number(r.section_count),
      completed_count: locked ? 0 : Number(r.completed_count),
      progress_pct:    (!locked && r.section_count > 0)
        ? Math.round((Number(r.completed_count) / Number(r.section_count)) * 100)
        : 0,
      locked,
      min_plan: r.min_plan || "inicial",
    };
  }));
}

export async function getCourseById(courseId, sellerId, sellerPlanId = "inicial") {
  const { rows: courseRows } = await pool.query(
    `SELECT * FROM academy_courses WHERE id = $1 AND published = true`,
    [courseId]
  );
  if (!courseRows[0]) return null;
  const minOrder    = PLAN_ORDER[courseRows[0].min_plan || "inicial"] ?? 1;
  const sellerOrder = PLAN_ORDER[sellerPlanId] ?? 1;
  if (sellerOrder < minOrder) return { ...courseRows[0], locked: true, sections: [] };

  const { rows: sections } = await pool.query(
    `SELECT s.*,
            CASE WHEN p.section_id IS NOT NULL THEN true ELSE false END AS completed
     FROM academy_sections s
     LEFT JOIN academy_progress p ON p.section_id = s.id AND p.seller_id = $2
     WHERE s.course_id = $1
     ORDER BY s.sort_order ASC`,
    [courseId, sellerId]
  );

  const course = courseRows[0];
  return { ...course, thumbnail_url: await resolveThumb(course.thumbnail_url), sections };
}

export async function markComplete(sellerId, sectionId) {
  await pool.query(
    `INSERT INTO academy_progress (seller_id, section_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [sellerId, sectionId]
  );
}

export async function markIncomplete(sellerId, sectionId) {
  await pool.query(
    `DELETE FROM academy_progress WHERE seller_id = $1 AND section_id = $2`,
    [sellerId, sectionId]
  );
}

export async function recordView(sellerId, courseId) {
  await pool.query(
    `INSERT INTO academy_views (seller_id, course_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [sellerId, courseId]
  );
}

// ── Admin ─────────────────────────────────────────────────────

export async function adminGetCourses() {
  const { rows } = await pool.query(
    `SELECT c.*, COUNT(s.id) AS section_count
     FROM academy_courses c
     LEFT JOIN academy_sections s ON s.course_id = c.id
     GROUP BY c.id
     ORDER BY c.sort_order ASC, c.created_at ASC`
  );
  return Promise.all(rows.map(async r => ({
    ...r,
    thumbnail_url: await resolveThumb(r.thumbnail_url),
    section_count: Number(r.section_count),
  })));
}

export async function adminGetCourse(courseId) {
  const { rows: courseRows } = await pool.query(
    `SELECT * FROM academy_courses WHERE id = $1`, [courseId]
  );
  if (!courseRows[0]) return null;
  const { rows: sections } = await pool.query(
    `SELECT * FROM academy_sections WHERE course_id = $1 ORDER BY sort_order ASC`,
    [courseId]
  );
  const course = courseRows[0];
  return { ...course, thumbnail_url: await resolveThumb(course.thumbnail_url), sections };
}

export async function adminCreateCourse({ title, description, thumbnail_url, duration_min, sort_order, min_plan }) {
  const { rows } = await pool.query(
    `INSERT INTO academy_courses (title, description, thumbnail_url, duration_min, sort_order, min_plan)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [title, description || null, thumbnail_url || null, duration_min || 0, sort_order || 0, min_plan || "inicial"]
  );
  return rows[0];
}

export async function adminUpdateCourse(courseId, { title, description, thumbnail_url, duration_min, sort_order, published, min_plan }) {
  const { rows } = await pool.query(
    `UPDATE academy_courses
     SET title=$1, description=$2, thumbnail_url=$3, duration_min=$4, sort_order=$5, published=$6, min_plan=$7
     WHERE id=$8 RETURNING *`,
    [title, description || null, thumbnail_url || null, duration_min || 0, sort_order || 0, !!published, min_plan || "inicial", courseId]
  );
  return rows[0];
}

export async function adminDeleteCourse(courseId) {
  await pool.query(`DELETE FROM academy_courses WHERE id = $1`, [courseId]);
}

export async function adminCreateSection(courseId, { title, content_md, video_url, image_urls, sort_order, duration_min, chapters }) {
  const { rows } = await pool.query(
    `INSERT INTO academy_sections (course_id, title, content_md, video_url, image_urls, sort_order, duration_min, chapters)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [courseId, title, content_md || null, video_url || null,
     JSON.stringify(image_urls || []), sort_order || 0, duration_min || 0,
     JSON.stringify(chapters || [])]
  );
  return rows[0];
}

export async function adminUpdateSection(sectionId, { title, content_md, video_url, image_urls, sort_order, duration_min, chapters }) {
  const { rows } = await pool.query(
    `UPDATE academy_sections
     SET title=$1, content_md=$2, video_url=$3, image_urls=$4, sort_order=$5, duration_min=$6, chapters=$7
     WHERE id=$8 RETURNING *`,
    [title, content_md || null, video_url || null,
     JSON.stringify(image_urls || []), sort_order || 0, duration_min || 0,
     JSON.stringify(chapters || []), sectionId]
  );
  return rows[0];
}

export async function adminDeleteSection(sectionId) {
  await pool.query(`DELETE FROM academy_sections WHERE id = $1`, [sectionId]);
}

export async function adminGetCourseUsers(courseId, type) {
  if (type === "viewed") {
    const { rows } = await pool.query(`
      SELECT s.id, s.name, s.email, v.viewed_at AS event_at
      FROM academy_views v
      JOIN sellers s ON s.id = v.seller_id
      WHERE v.course_id = $1
      ORDER BY v.viewed_at DESC
    `, [courseId]);
    return rows;
  }
  if (type === "started") {
    const { rows } = await pool.query(`
      SELECT s.id, s.name, s.email, MIN(ap.completed_at) AS event_at
      FROM academy_progress ap
      JOIN academy_sections sec ON sec.id = ap.section_id
      JOIN sellers s ON s.id = ap.seller_id
      WHERE sec.course_id = $1
      GROUP BY s.id, s.name, s.email
      ORDER BY event_at DESC
    `, [courseId]);
    return rows;
  }
  if (type === "completed") {
    const { rows } = await pool.query(`
      SELECT s.id, s.name, s.email, MAX(ap.completed_at) AS event_at
      FROM academy_progress ap
      JOIN academy_sections sec ON sec.id = ap.section_id
      JOIN sellers s ON s.id = ap.seller_id
      WHERE sec.course_id = $1
      GROUP BY s.id, s.name, s.email
      HAVING COUNT(DISTINCT ap.section_id) = (SELECT COUNT(*) FROM academy_sections WHERE course_id = $1)
      ORDER BY event_at DESC
    `, [courseId]);
    return rows;
  }
  return [];
}

export async function adminGetAllMetrics() {
  const { rows } = await pool.query(`
    SELECT
      c.id::text AS course_id,
      (SELECT COUNT(*) FROM academy_views v WHERE v.course_id = c.id)::int             AS views,
      (SELECT COUNT(DISTINCT ap.seller_id)
       FROM academy_progress ap
       JOIN academy_sections s ON s.id = ap.section_id
       WHERE s.course_id = c.id)::int                                                   AS started,
      (SELECT COUNT(*) FROM (
         SELECT ap.seller_id
         FROM academy_progress ap
         JOIN academy_sections s ON s.id = ap.section_id
         WHERE s.course_id = c.id
         GROUP BY ap.seller_id
         HAVING COUNT(DISTINCT ap.section_id) =
           (SELECT COUNT(*) FROM academy_sections WHERE course_id = c.id)
       ) sub)::int                                                                       AS completed
    FROM academy_courses c
  `);
  return Object.fromEntries(rows.map(r => [r.course_id, {
    views:     r.views,
    started:   r.started,
    completed: r.completed,
  }]));
}

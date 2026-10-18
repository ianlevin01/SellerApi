// src/ml/mlQuestionsRepository.js — preguntas de compradores (Preguntas y Respuestas de ML) +
// configuración del bot de respuesta automática, por vendedor.
import pool from "../database/db.js";

export async function getSettings(sellerId) {
  const { rows } = await pool.query(
    `SELECT enabled, business_rules, product_info_instructions FROM ml_ai_reply_settings WHERE seller_id = $1`,
    [sellerId]
  );
  return rows[0] || { enabled: false, business_rules: "", product_info_instructions: "" };
}

// Los 3 campos son opcionales (undefined = "no tocar ese campo") — así el toggle de la barra
// superior puede prender/apagar el bot con un solo PUT {enabled} sin pisar las reglas de
// negocio/información de productos que el vendedor ya haya cargado desde el modal.
export async function upsertSettings(sellerId, { enabled, businessRules, productInfoInstructions }) {
  await pool.query(
    `INSERT INTO ml_ai_reply_settings (seller_id, enabled, business_rules, product_info_instructions)
     VALUES ($1, COALESCE($2, false), COALESCE($3, ''), COALESCE($4, ''))
     ON CONFLICT (seller_id) DO UPDATE SET
       enabled = COALESCE($2, ml_ai_reply_settings.enabled),
       business_rules = COALESCE($3, ml_ai_reply_settings.business_rules),
       product_info_instructions = COALESCE($4, ml_ai_reply_settings.product_info_instructions),
       updated_at = now()`,
    [sellerId, enabled, businessRules, productInfoInstructions]
  );
}

// INSERT ... ON CONFLICT DO NOTHING es el mecanismo de idempotencia acá también (mismo criterio
// que web_orders/ml_returns) — ml_question_id es UNIQUE, así que una notificación repetida del
// mismo webhook no duplica la fila.
export async function insertQuestion(sellerId, { mlQuestionId, mlItemId, productId, buyerMlUserId, questionText }) {
  const { rows } = await pool.query(
    `INSERT INTO ml_questions (seller_id, ml_question_id, ml_item_id, product_id, buyer_ml_user_id, question_text)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (ml_question_id) DO NOTHING
     RETURNING id`,
    [sellerId, mlQuestionId, mlItemId, productId, buyerMlUserId, questionText]
  );
  return rows[0] || null;
}

export async function getQuestionByMlId(mlQuestionId) {
  const { rows } = await pool.query(`SELECT * FROM ml_questions WHERE ml_question_id = $1`, [mlQuestionId]);
  return rows[0] || null;
}

export async function markAnswered(id, { answerText, answeredBy, needsHuman }) {
  await pool.query(
    `UPDATE ml_questions SET answer_text = $2, answered_by = $3, needs_human = $4, answered_at = now() WHERE id = $1`,
    [id, answerText, answeredBy, needsHuman]
  );
}

export async function listForSeller(sellerId, limit = 300) {
  const { rows } = await pool.query(
    `SELECT q.*, COALESCE(p.name, 'Producto sin vincular') AS product_name,
       (SELECT key FROM product_images WHERE product_id = p.id ORDER BY created_at LIMIT 1) AS image_key
     FROM ml_questions q
     LEFT JOIN products p ON p.id = q.product_id
     WHERE q.seller_id = $1
     ORDER BY q.created_at DESC
     LIMIT $2`,
    [sellerId, limit]
  );
  return rows;
}

export async function getQuestionById(id, sellerId) {
  const { rows } = await pool.query(`SELECT * FROM ml_questions WHERE id = $1 AND seller_id = $2`, [id, sellerId]);
  return rows[0] || null;
}

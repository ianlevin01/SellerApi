/**
 * simulateMlQuestion.mjs — simula que llega una pregunta de un comprador en Mercado Libre, para
 * probar todo el flujo interno (guardado, mail al vendedor, respuesta automática con IA o
 * escalado a humano) SIN necesitar una pregunta real.
 *
 * Arma un objeto "question" con la misma forma que devuelve la API de Mercado Libre y lo procesa
 * con mlWebhookController.processQuestion() — la misma función que corre en producción cuando
 * llega el webhook real, salvo por el primer paso (svc.getQuestion(), que sí pega contra la API
 * de ML) que acá se reemplaza por este objeto armado a mano.
 *
 * NO simula ni puede simular:
 *   - El posteo real de la respuesta en Mercado Libre — el question_id es inventado, así que
 *     POST /answers siempre devuelve 404 "Question not found" (esperado, no es un bug). Sirve
 *     igual para confirmar que la IA decide bien y que se guarda todo correcto en la base; para
 *     ver la respuesta publicada de verdad hace falta una pregunta real.
 *
 * Uso:
 *   node scripts/simulateMlQuestion.mjs vendedor@email.com "¿De qué material es?"
 *   node scripts/simulateMlQuestion.mjs vendedor@email.com "¿Hacen envíos a Córdoba?" --item MLA123456789
 */
import "dotenv/config";
import pool from "../src/database/db.js";
import { processQuestion } from "../src/ml/mlWebhookController.js";

function parseArgs(argv) {
  const [email, questionText, ...rest] = argv;
  const opts = { email, questionText, item: null };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--item") opts.item = rest[++i];
  }
  return opts;
}

async function main() {
  const { email, questionText, item } = parseArgs(process.argv.slice(2));
  if (!email || !questionText) {
    console.error('Uso: node scripts/simulateMlQuestion.mjs <email-del-vendedor> "<pregunta>" [--item MLA...]');
    process.exit(1);
  }

  const { rows: sellerRows } = await pool.query(`SELECT id, email, name FROM sellers WHERE email = $1`, [email]);
  const seller = sellerRows[0];
  if (!seller) { console.error(`No se encontró ningún vendedor con email ${email}`); process.exit(1); }
  console.log(`Vendedor: ${seller.name} (${seller.email})`);

  let listing;
  if (item) {
    const { rows } = await pool.query(`SELECT ml_item_id, product_id FROM ml_listings WHERE ml_item_id = $1 AND seller_id = $2`, [item, seller.id]);
    listing = rows[0];
    if (!listing) { console.error(`La publicación ${item} no existe o no es de este vendedor`); process.exit(1); }
  } else {
    const { rows } = await pool.query(
      `SELECT ml_item_id, product_id FROM ml_listings WHERE seller_id = $1 AND status = 'active' AND product_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      [seller.id]
    );
    listing = rows[0];
    if (!listing) { console.error("Este vendedor no tiene ninguna publicación activa con producto vinculado para simular una pregunta"); process.exit(1); }
  }
  console.log(`Publicación elegida: ${listing.ml_item_id}`);

  const settings = await pool.query(`SELECT enabled FROM ml_ai_reply_settings WHERE seller_id = $1`, [seller.id]).then(r => r.rows[0]);
  console.log(`Respuesta automática: ${settings?.enabled ? "activada" : "desactivada"} para este vendedor`);

  const fakeQuestion = {
    id: Math.floor(Date.now() / 1000), // ML usa ids numéricos — alcanza con que sea único para esta prueba
    item_id: listing.ml_item_id,
    text: questionText,
    status: "UNANSWERED",
    date_created: new Date().toISOString(),
    from: { id: 999000111 }, // comprador de prueba fijo — reusarlo permite probar el escalado a humano entre corridas
    answer: null,
  };

  await processQuestion(seller.id, fakeQuestion);

  const { rows: saved } = await pool.query(`SELECT * FROM ml_questions WHERE ml_question_id = $1`, [String(fakeQuestion.id)]);
  const row = saved[0];
  if (!row) { console.error("processQuestion() no guardó nada — revisá la migración de ml_questions/ml_ai_reply_settings."); process.exit(1); }

  console.log("\n✅ Pregunta simulada procesada:");
  console.log(`   answered_by: ${row.answered_by}  |  needs_human: ${row.needs_human}`);
  console.log(`   Respuesta: ${row.answer_text || "(ninguna — respuesta automática desactivada o todavía no se procesó)"}`);
  console.log("\nProbá ahora en SellerSystem → Mercado Libre → Chats: debería verse esta pregunta.");

  await pool.end();
}

main().catch(err => { console.error("Error:", err); process.exit(1); });

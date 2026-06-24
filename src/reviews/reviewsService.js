import OpenAI from "openai";
import * as repo    from "./reviewsRepository.js";
import * as intRepo from "../integrations/integrationsRepository.js";
import pool         from "../database/db.js";

function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY no configurada");
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export async function generateReviews(pageId, productId, sellerId) {
  const active = await intRepo.isActive(pageId, "star_ai");
  if (!active) throw { status: 403, message: "StarAI no está activado para esta tienda" };

  let name, desc;

  const { rows } = await pool.query(
    `SELECT p.name, p.description, sp.custom_name, sp.custom_desc
     FROM products p
     LEFT JOIN seller_products sp ON sp.product_id = p.id AND sp.page_id = $2
     WHERE p.id = $1`,
    [productId, pageId]
  );

  if (rows.length) {
    const p = rows[0];
    name = p.custom_name || p.name;
    desc = (p.custom_desc || p.description || "").slice(0, 200);
  } else {
    const { rows: comboRows } = await pool.query(
      `SELECT name, description FROM page_combos WHERE id = $1 AND page_id = $2`,
      [productId, pageId]
    );
    if (!comboRows.length) throw { status: 404, message: "Producto no encontrado" };
    name = comboRows[0].name;
    desc = (comboRows[0].description || "").slice(0, 200);
  }

  const prompt = `Generá exactamente 5 reseñas de clientes reales en español argentino para el producto "${name}"${desc ? `. Descripción: ${desc}` : ""}. Cada reseña debe tener:
- Un nombre argentino (nombre + apellido)
- rating entre 4 y 5
- comentario de 1-3 oraciones, natural, como lo escribiría una persona real

Respondé SOLO con un JSON array: [{"author_name":"...","rating":5,"comment":"..."},...] sin texto adicional.`;

  const openai   = getOpenAI();
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini", max_tokens: 900, temperature: 0.85,
    messages: [{ role: "user", content: prompt }],
  });

  let parsed;
  try {
    const text = response.choices[0].message.content.trim();
    const start = text.indexOf("[");
    const end   = text.lastIndexOf("]");
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw { status: 500, message: "StarAI no pudo generar las reseñas. Intentá de nuevo." };
  }

  const toInsert = parsed.map(r => ({
    product_id:  productId,
    page_id:     pageId,
    seller_id:   sellerId,
    author_name: String(r.author_name || "").slice(0, 100),
    rating:      Math.max(1, Math.min(5, Number(r.rating) || 5)),
    comment:     String(r.comment || "").slice(0, 500),
    source:      "star_ai",
  }));

  await repo.insertMany(toInsert);
  return repo.listByProduct(pageId, productId);
}

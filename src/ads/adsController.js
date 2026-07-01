import * as repo from "./adsRepository.js";
import { generateAdCopy, generateSingleField, generateAdImage, chatWithAgent } from "./adsCopyService.js";
import pool from "../database/db.js";
import { getBuffer } from "../utils/s3Client.js";

function handleError(res, err) {
  console.error("[ads]", err?.status ?? 500, err?.message, err?.error ?? "");
  const status  = err?.status  || 500;
  const message = err?.message || "Error interno";
  return res.status(status).json({ message });
}

// ── Campaigns ─────────────────────────────────────────────────

export async function listCampaigns(req, res) {
  try {
    return res.json(await repo.getCampaigns(req.seller.id));
  } catch (err) { handleError(res, err); }
}

export async function createCampaign(req, res) {
  try {
    if (!req.body.name?.trim()) return res.status(400).json({ message: "El nombre de la campaña es requerido" });
    return res.status(201).json(await repo.createCampaign(req.seller.id, req.body));
  } catch (err) { handleError(res, err); }
}

export async function updateCampaign(req, res) {
  try {
    const campaign = await repo.updateCampaign(req.params.id, req.seller.id, req.body);
    if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
    return res.json(campaign);
  } catch (err) { handleError(res, err); }
}

export async function deleteCampaign(req, res) {
  try {
    const existing = await repo.getCampaign(req.params.id, req.seller.id);
    if (!existing) return res.status(404).json({ message: "Campaña no encontrada" });
    await repo.deleteCampaign(req.params.id, req.seller.id);
    return res.status(204).end();
  } catch (err) { handleError(res, err); }
}

// ── Creatives ─────────────────────────────────────────────────

export async function listCreatives(req, res) {
  try {
    const campaign = await repo.getCampaign(req.params.campaignId, req.seller.id);
    if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
    return res.json(await repo.getCreatives(req.params.campaignId, req.seller.id));
  } catch (err) { handleError(res, err); }
}

export async function createCreative(req, res) {
  try {
    const campaign = await repo.getCampaign(req.params.campaignId, req.seller.id);
    if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
    return res.status(201).json(await repo.createCreative(req.params.campaignId, req.seller.id, req.body));
  } catch (err) { handleError(res, err); }
}

export async function updateCreative(req, res) {
  try {
    const creative = await repo.updateCreative(req.params.id, req.seller.id, req.body);
    if (!creative) return res.status(404).json({ message: "Creativo no encontrado" });
    return res.json(creative);
  } catch (err) { handleError(res, err); }
}

export async function deleteCreative(req, res) {
  try {
    await repo.deleteCreative(req.params.id, req.seller.id);
    return res.status(204).end();
  } catch (err) { handleError(res, err); }
}

// ── AI copy generation ────────────────────────────────────────

async function resolveProduct(productId, sellerId) {
  if (!productId) return {};
  const { rows } = await pool.query(
    `SELECT COALESCE(sp.custom_name, p.name) AS name,
            COALESCE(sp.custom_desc, p.description) AS description,
            sp.custom_price AS price,
            COALESCE(
              (SELECT si.key FROM seller_images si WHERE si.seller_id = $2 AND si.product_id = p.id ORDER BY si."order" LIMIT 1),
              (SELECT pi.key FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.created_at LIMIT 1)
            ) AS first_image_key
     FROM products p
     LEFT JOIN seller_products sp ON sp.product_id = p.id AND sp.seller_id = $2
     WHERE p.id = $1 LIMIT 1`,
    [productId, sellerId]
  );
  return rows[0] || {};
}

export async function generateCopy(req, res) {
  try {
    const { product_id, product_name, product_desc, price, objective, context, store_name } = req.body;
    const pData = await resolveProduct(product_id, req.seller.id);

    const productName = pData.name  || product_name;
    const productDesc = pData.description || product_desc;
    const productPrice = pData.price || price;

    if (!productName?.trim()) return res.status(400).json({ message: "Se necesita el nombre del producto" });

    const result = await generateAdCopy({ productName, productDesc, price: productPrice, objective, context, storeName: store_name });
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

// Generate a single copy field
export async function generateField(req, res) {
  try {
    const { field, product_id, product_name, product_desc, price, objective, context, existing_copy } = req.body;

    if (!["headline", "primary_text", "description"].includes(field)) {
      return res.status(400).json({ message: "Campo inválido. Debe ser: headline, primary_text o description" });
    }

    const pData = await resolveProduct(product_id, req.seller.id);
    const productName = pData.name || product_name;
    if (!productName?.trim()) return res.status(400).json({ message: "Se necesita el nombre del producto" });

    const value = await generateSingleField({
      field,
      productName,
      productDesc: pData.description || product_desc,
      price: pData.price || price,
      objective,
      context,
      existingCopy: existing_copy || {},
    });

    return res.json({ value });
  } catch (err) { handleError(res, err); }
}

// Generate image
export async function generateImage(req, res) {
  try {
    const { prompt, product_id, product_name, product_desc, format, style } = req.body;

    const pData = await resolveProduct(product_id, req.seller.id);
    const productName = pData.name || product_name || "producto";

    // Download reference image from S3 if available
    let imageBuffer = null;
    if (pData.first_image_key) {
      try {
        imageBuffer = await getBuffer(pData.first_image_key);
        console.log("[ads:generateImage] imagen de referencia cargada, key:", pData.first_image_key, "bytes:", imageBuffer.length);
      } catch (e) {
        console.warn("[ads:generateImage] no se pudo cargar la imagen de referencia:", e.message);
      }
    }

    const result = await generateAdImage({
      prompt,
      productName,
      productDesc: pData.description || product_desc,
      format:      format || "feed",
      style:       style  || "clean",
      imageBuffer,
    });

    console.log("[ads:generateImage] OK, url:", result.url?.slice(0, 60));
    return res.json(result);
  } catch (err) {
    console.error("[ads:generateImage] ERROR:", err?.status, err?.message);
    handleError(res, err);
  }
}

// Campaign agent chat
export async function agentChat(req, res) {
  try {
    const { message, history } = req.body;
    if (!message?.trim()) return res.status(400).json({ message: "Mensaje requerido" });

    // Build context from seller's data
    const { campaigns, creatives } = await repo.getCampaignsWithCreatives(req.seller.id);

    let campaignsContext = "";
    if (campaigns.length === 0) {
      campaignsContext = "El vendedor no tiene campañas creadas todavía.";
    } else {
      const totalBudget = campaigns.reduce((s, c) => s + (Number(c.daily_budget) || 0), 0);
      const statusCounts = campaigns.reduce((acc, c) => { acc[c.status] = (acc[c.status] || 0) + 1; return acc; }, {});

      campaignsContext = `RESUMEN GENERAL:
- Total de campañas: ${campaigns.length}
- Estados: ${Object.entries(statusCounts).map(([k,v]) => `${k}: ${v}`).join(", ")}
- Presupuesto diario total: $${Math.round(totalBudget).toLocaleString("es-AR")} ARS
- Total de creativos: ${creatives.length}

CAMPAÑAS:
${campaigns.slice(0, 10).map(c => `- "${c.name}" | Objetivo: ${c.objective} | Estado: ${c.status} | Presupuesto: ${c.daily_budget ? `$${Number(c.daily_budget).toLocaleString("es-AR")}/día` : "sin definir"} | Creativos: ${c.creatives_count} | Tienda: ${c.store_name || "todas"}`).join("\n")}

${creatives.length > 0 ? `ÚLTIMOS CREATIVOS:
${creatives.slice(0, 5).map(cr => `- Headline: "${cr.headline || "(sin headline)"}" | Formato: ${cr.format} | Producto: ${cr.product_name || "genérico"}`).join("\n")}` : ""}`;
    }

    const reply = await chatWithAgent({ message, campaignsContext, history: history || [] });
    return res.json({ reply });
  } catch (err) { handleError(res, err); }
}

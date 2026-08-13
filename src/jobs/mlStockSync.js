// Red de seguridad: el stock que se vende por Mercado Libre sale del mismo pool físico
// compartido que usa la tienda ecommerce — un seller puede quedarse sin stock real aunque él
// mismo no haya vendido nada, simplemente porque otros vendedores (u otro canal) lo consumieron.
// Este job, cada 15 minutos:
//   1) sincroniza a ML la cantidad disponible real de cada publicación activa (para que ML no
//      muestre más unidades de las que quedan),
//   2) pausa las publicaciones que se quedaron por debajo del mínimo y avisa por mail —
//      mismo umbral y mismo criterio "producto caro" que ya usa la tienda (stockListener.js),
//   3) reactiva (y avisa) las que se pausaron por stock y ya se repusieron.
// El stock "efectivo" de un seller es su propia reserva (garantizada solo para él, vía
// seller_stock_reserves) + lo que quede del pool compartido sin reservar — así una reserva
// propia lo protege del consumo de otros vendedores.
import * as repo from "../ml/mlRepository.js";
import * as listingSvc from "../ml/mlListingService.js";
import { transporter } from "../config/mailer.js";
import { calcShownCost } from "../utils/pricing.js";

const INTERVAL_MS = 15 * 60 * 1000; // 15 minutos

function editUrl(mlItemId) {
  return `https://articulo.mercadolibre.com.ar/${String(mlItemId).replace("-", "")}`;
}

async function sendMlStockEmail({ sellerEmail, sellerName, productName, productCode, permalink, mlItemId, kind }) {
  const isPaused = kind === "paused";
  const codeSuffix = productCode ? ` (código: ${productCode})` : "";
  const subject  = isPaused
    ? `Publicación pausada en Mercado Libre: ${productName}`
    : `Publicación reactivada en Mercado Libre: ${productName}`;
  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
      <h2 style="color:${isPaused ? "#ef4444" : "#059669"}">
        ${isPaused ? "Publicación pausada por falta de stock" : "Publicación reactivada"}
      </h2>
      <p>Hola <strong>${sellerName}</strong>,</p>
      ${isPaused
        ? `<p>Tu publicación de <strong>${productName}</strong>${codeSuffix} en Mercado Libre
             se <strong>pausó automáticamente</strong> porque el stock disponible bajó del mínimo.</p>
           <p>La vamos a reactivar sola apenas vuelva a haber stock suficiente.</p>`
        : `<p>Tu publicación de <strong>${productName}</strong>${codeSuffix} en Mercado Libre
             se <strong>reactivó automáticamente</strong> — ya volvió a haber stock disponible.</p>`
      }
      <p><a href="${permalink || editUrl(mlItemId)}" target="_blank">Ver publicación en Mercado Libre</a></p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
      <p style="color:#999;font-size:13px">
        Ventaz &middot; <a href="https://ventaz.com.ar">ventaz.com.ar</a>
      </p>
    </div>
  `;
  try {
    await transporter.sendMail({
      from: `"Ventaz" <${process.env.SMTP_FROM_AWS || "noreply@ventaz.com.ar"}>`,
      to: sellerEmail,
      subject,
      html,
    });
  } catch (e) {
    console.error(`[mlStockSync] email error para ${sellerEmail}:`, e.message);
  }
}

async function checkStock() {
  let listings;
  try {
    listings = await repo.getActiveListingsWithStock();
  } catch (err) {
    console.error("[mlStockSync] error obteniendo listings:", err.message);
    return;
  }

  for (const l of listings) {
    try {
      const precio1     = calcShownCost(l.costo_usd, l.cotizacion, 30);
      const isExpensive = precio1 > 100000;
      const available   = Number(l.available_stock);
      const outOfStock  = isExpensive ? available <= 0 : available < 10;

      // Pausado automático por falta de stock DESACTIVADO a propósito (pedido explícito) —
      // queda el código armado para reactivarlo más adelante, por ahora no pausa nada.
      // if (outOfStock && l.status === "active") {
      //   await listingSvc.pauseListing(l.seller_id, l.ml_item_id, "stock");
      //   await sendMlStockEmail({
      //     sellerEmail: l.seller_email, sellerName: l.seller_name,
      //     productName: l.product_name, productCode: l.product_code || l.product_id,
      //     permalink: l.permalink, mlItemId: l.ml_item_id, kind: "paused",
      //   });
      //   console.log(`[mlStockSync] pausado ${l.ml_item_id} — stock efectivo ${available}`);
      // } else
      if (!outOfStock && l.status === "paused" && l.pause_reason === "stock") {
        await listingSvc.reactivateListing(l.seller_id, l.ml_item_id);
        await listingSvc.syncStockToMl(l.seller_id, l.ml_item_id, available);
        await sendMlStockEmail({
          sellerEmail: l.seller_email, sellerName: l.seller_name,
          productName: l.product_name, productCode: l.product_code || l.product_id,
          permalink: l.permalink, mlItemId: l.ml_item_id, kind: "reactivated",
        });
        console.log(`[mlStockSync] reactivado ${l.ml_item_id} — stock repuesto (${available})`);
      } else if (l.status === "active") {
        // Sigue activa y con stock suficiente — sincronizamos la cantidad exacta para que
        // ML no muestre más unidades de las que realmente quedan disponibles.
        await listingSvc.syncStockToMl(l.seller_id, l.ml_item_id, available);
      }
    } catch (err) {
      console.error(`[mlStockSync] error procesando ${l.ml_item_id}:`, err.message);
    }
  }

  await checkComboStock();
}

// Mismo criterio que checkStock() de arriba, pero para combos de ML: el stock disponible de
// un combo es cuántas veces se puede armar completo con lo que queda de cada producto que lo
// compone (mismo cálculo que ya usa mlListingService.publishCombo al publicar).
async function checkComboStock() {
  let combos;
  try {
    combos = await repo.getActiveComboListings();
  } catch (err) {
    console.error("[mlStockSync] error obteniendo combos:", err.message);
    return;
  }

  for (const c of combos) {
    try {
      const products = await repo.getComboProducts(c.ml_combo_id);
      if (!products.length) continue;

      const available = Math.min(...products.map(p => Math.floor(Number(p.available_stock) / p.quantity)));
      const comboPrecio1 = products.reduce(
        (sum, p) => sum + calcShownCost(p.costo_usd, c.cotizacion, 30) * p.quantity, 0
      );
      const isExpensive = comboPrecio1 > 100000;
      const outOfStock  = isExpensive ? available <= 0 : available < 10;

      // Pausado automático por falta de stock DESACTIVADO a propósito (pedido explícito) —
      // queda el código armado para reactivarlo más adelante, por ahora no pausa nada.
      // if (outOfStock && c.status === "active") {
      //   await listingSvc.pauseListing(c.seller_id, c.ml_item_id, "stock");
      //   await sendMlStockEmail({
      //     sellerEmail: c.seller_email, sellerName: c.seller_name,
      //     productName: c.combo_name, productCode: null,
      //     permalink: c.permalink, mlItemId: c.ml_item_id, kind: "paused",
      //   });
      //   console.log(`[mlStockSync] combo pausado ${c.ml_item_id} — stock efectivo ${available}`);
      // } else
      if (!outOfStock && c.status === "paused" && c.pause_reason === "stock") {
        await listingSvc.reactivateListing(c.seller_id, c.ml_item_id);
        await listingSvc.syncStockToMl(c.seller_id, c.ml_item_id, available);
        await sendMlStockEmail({
          sellerEmail: c.seller_email, sellerName: c.seller_name,
          productName: c.combo_name, productCode: null,
          permalink: c.permalink, mlItemId: c.ml_item_id, kind: "reactivated",
        });
        console.log(`[mlStockSync] combo reactivado ${c.ml_item_id} — stock repuesto (${available})`);
      } else if (c.status === "active") {
        await listingSvc.syncStockToMl(c.seller_id, c.ml_item_id, available);
      }
    } catch (err) {
      console.error(`[mlStockSync] error procesando combo ${c.ml_item_id}:`, err.message);
    }
  }
}

export function startMlStockSync() {
  console.log("[mlStockSync] Iniciado — revisión cada 15 minutos");
  setTimeout(() => checkStock().catch(err => console.error("[mlStockSync] error inicial:", err.message)), 10_000);
  setInterval(() => checkStock().catch(err => console.error("[mlStockSync] error en ciclo:", err.message)), INTERVAL_MS);
}

import * as repo from "./mlRepository.js";
import * as svc  from "./mlService.js";
import * as walletSvc from "./mlWalletService.js";
import * as listingSvc from "./mlListingService.js";
import { getValidToken } from "./mlTokenService.js";
import { getSellerPlan, getPlanMlGraceHours } from "../utils/sellerPlan.js";

const SELLER_APP = process.env.SELLER_APP_URL || "https://ventaz.com.ar";
const REDIRECT_BASE = `${SELLER_APP}/mercado-libre`;

// GET /seller/ml/connect
export async function getConnectUrl(req, res) {
  try {
    const state = await repo.createOAuthState(req.seller.id);
    const url   = svc.getOAuthUrl(state);
    return res.json({ url });
  } catch (err) {
    console.error("[ml] getConnectUrl:", err.message);
    return res.status(500).json({ message: "Error generando URL de conexión" });
  }
}

// GET /seller/ml/callback — ML redirige aquí con code+state
export async function callback(req, res) {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`${REDIRECT_BASE}?ml_error=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return res.redirect(`${REDIRECT_BASE}?ml_error=missing_params`);
  }

  try {
    const sellerId = await repo.consumeOAuthState(state);
    if (!sellerId) {
      return res.redirect(`${REDIRECT_BASE}?ml_error=state_invalid`);
    }

    const { accessToken, refreshToken, expiresAt, mlUserId } = await svc.exchangeCodeForToken(code);
    const { nickname, siteId } = await svc.getUser(accessToken);

    await repo.upsertConnection(sellerId, {
      accessToken, refreshToken, expiresAt, mlUserId, mlNickname: nickname, siteId,
    });

    return res.redirect(`${REDIRECT_BASE}?ml_connected=true`);
  } catch (err) {
    console.error("[ml] callback:", err.message);
    return res.redirect(`${REDIRECT_BASE}?ml_error=server_error`);
  }
}

// GET /seller/ml/status
export async function getStatus(req, res) {
  try {
    const conn = await repo.getConnection(req.seller.id);
    if (!conn) return res.json({ connected: false });
    return res.json({
      connected:        true,
      ml_nickname:      conn.ml_nickname,
      site_id:          conn.site_id,
      token_expires_at: conn.token_expires_at,
    });
  } catch (err) {
    console.error("[ml] getStatus:", err.message);
    return res.status(500).json({ message: "Error" });
  }
}

// DELETE /seller/ml/disconnect
export async function disconnect(req, res) {
  try {
    await repo.deleteConnection(req.seller.id);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[ml] disconnect:", err.message);
    return res.status(500).json({ message: "Error" });
  }
}

// ── Wallet / tarjeta ──────────────────────────────────────────

// GET /seller/ml/wallet
export async function getWallet(req, res) {
  try {
    const [balance, card, pendingDebt, blockedDebt, { plan_id }] = await Promise.all([
      walletSvc.getBalance(req.seller.id),
      walletSvc.getCardStatus(req.seller.id),
      walletSvc.getPendingDebt(req.seller.id),
      walletSvc.getBlockedDebt(req.seller.id),
      getSellerPlan(req.seller.id),
    ]);
    return res.json({
      balance, pendingDebt, blockedDebt, ...card,
      planId: plan_id, graceHours: getPlanMlGraceHours(plan_id),
    });
  } catch (err) {
    console.error("[ml] getWallet:", err.message);
    return res.status(500).json({ message: "Error" });
  }
}

// POST /seller/ml/wallet/pay-debt — cobra toda la deuda pendiente de una vez, desde la
// tarjeta guardada, y reactiva publicaciones pausadas por cobro fallido.
export async function payDebt(req, res) {
  try {
    const result = await walletSvc.payPendingDebtNow(req.seller.id);
    return res.json(result);
  } catch (err) {
    console.error("[ml] payDebt:", err.message);
    return res.status(err.status || 500).json({ message: err.message || "Error" });
  }
}


// POST /seller/ml/wallet/card  { card_token }
export async function saveCard(req, res) {
  try {
    const { card_token } = req.body;
    if (!card_token) return res.status(400).json({ message: "card_token requerido" });
    const result = await walletSvc.saveCard(req.seller.id, card_token);
    return res.json(result);
  } catch (err) {
    console.error("[ml] saveCard:", err.response?.data || err.message);
    return res.status(err.status || 500).json({ message: err.message || "No se pudo guardar la tarjeta" });
  }
}

// POST /seller/ml/wallet/topup  { amount }
export async function topup(req, res) {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ message: "Monto inválido" });
    await walletSvc.topup(req.seller.id, amount);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[ml] topup:", err.message);
    return res.status(err.status || 500).json({ message: err.message || "Error" });
  }
}

// GET /seller/ml/wallet/history
export async function getWalletHistory(req, res) {
  try {
    return res.json(await walletSvc.getHistory(req.seller.id));
  } catch (err) {
    console.error("[ml] getWalletHistory:", err.message);
    return res.status(500).json({ message: "Error" });
  }
}

// ── Publicaciones ─────────────────────────────────────────────

// GET /seller/ml/listings
export async function getListings(req, res) {
  try {
    return res.json(await listingSvc.getListings(req.seller.id));
  } catch (err) {
    console.error("[ml] getListings:", err.message);
    return res.status(500).json({ message: "Error" });
  }
}

// GET /seller/ml/summary — para la pestaña "Resumen"
export async function getSummary(req, res) {
  try {
    return res.json(await listingSvc.getSummary(req.seller.id));
  } catch (err) {
    console.error("[ml] getSummary:", err.message);
    return res.status(500).json({ message: "Error" });
  }
}

// GET /seller/ml/categories/suggest?q=...
export async function suggestCategory(req, res) {
  try {
    const conn = await repo.getConnection(req.seller.id);
    const siteId = conn?.site_id || "MLA";
    const suggestions = await svc.suggestCategory(siteId, req.query.q || "");
    return res.json(suggestions);
  } catch (err) {
    console.error("[ml] suggestCategory:", err.message);
    return res.status(500).json({ message: "Error" });
  }
}

// GET /seller/ml/categories/:id/attributes
export async function getCategoryAttributes(req, res) {
  try {
    return res.json(await svc.getCategoryAttributes(req.params.id));
  } catch (err) {
    console.error("[ml] getCategoryAttributes:", err.message);
    return res.status(500).json({ message: "Error" });
  }
}

// GET /seller/ml/listing-fees?price=X&categoryId=Y&weightGrams=&volumeCm3=&freeShipping= —
// desglose de comisión ("Recibís"). Los últimos 3 params son opcionales — si vienen, además
// se calcula el costo estimado de envío gratis (mismo simulador que usa ML antes de publicar).
export async function getListingFees(req, res) {
  try {
    const token = await getValidToken(req.seller.id);
    if (!token) return res.status(400).json({ message: "Mercado Libre no está conectado" });
    const conn = await repo.getConnection(req.seller.id);
    const { price, categoryId, weightGrams, volumeCm3, freeShipping } = req.query;
    if (!price || !categoryId) return res.status(400).json({ message: "Faltan price/categoryId" });
    const fees = await svc.getListingFees(token, conn?.site_id || "MLA", { price, categoryId });

    if (freeShipping === "true" && weightGrams && volumeCm3 && conn?.ml_user_id) {
      const dimensions = listingSvc.estimateShippingDimensions(Number(weightGrams), Number(volumeCm3));
      if (dimensions) {
        fees.shippingCost = await svc.getShippingCostEstimate(token, conn.ml_user_id, { price, dimensions })
          .then(r => r.cost)
          .catch(err => {
            // vendedor sin Mercado Envíos configurado, o categoría sin simulador — no bloquea el
            // resto del cálculo, pero se loguea para poder diagnosticar si vuelve a fallar.
            console.error("[ml] getShippingCostEstimate:", err.message);
            return null;
          });
      }
    }

    return res.json(fees);
  } catch (err) {
    console.error("[ml] getListingFees:", err.message);
    return res.status(500).json({ message: "Error" });
  }
}

// GET /seller/ml/listings/:mlItemId/stats — visitas + vendidas + desglose de comisión actual
export async function getListingStats(req, res) {
  try {
    const token = await getValidToken(req.seller.id);
    if (!token) return res.status(400).json({ message: "Mercado Libre no está conectado" });
    const conn = await repo.getConnection(req.seller.id);
    const listing = await repo.getListingByMlItemId(req.params.mlItemId).catch(() => null);
    const [stats, fees] = await Promise.all([
      svc.getItemStats(token, req.params.mlItemId),
      listing?.price && listing?.ml_category_id
        ? svc.getListingFees(token, conn?.site_id || "MLA", { price: listing.price, categoryId: listing.ml_category_id })
        : null,
    ]);
    return res.json({ ...stats, fees });
  } catch (err) {
    console.error("[ml] getListingStats:", err.message);
    return res.status(500).json({ message: "Error" });
  }
}

// GET /seller/ml/listings/:mlItemId/picture-status — para el banner de "subiendo fotos..."
// que se muestra justo después de publicar, mientras ML procesa las fotos en 2do plano.
export async function getPictureStatus(req, res) {
  try {
    return res.json(await listingSvc.getPictureStatus(req.seller.id, req.params.mlItemId));
  } catch (err) {
    console.error("[ml] getPictureStatus:", err.message);
    return res.status(err.status || 500).json({ message: err.message || "Error" });
  }
}

// POST /seller/ml/pictures/upload — multipart, campo "image"
export async function uploadPicture(req, res) {
  try {
    if (!req.file) return res.status(400).json({ message: "Falta la imagen" });
    const result = await listingSvc.uploadPictureForSeller(req.seller.id, req.file);
    return res.json(result);
  } catch (err) {
    console.error("[ml] uploadPicture:", err.message);
    return res.status(err.status || 500).json({ message: err.message || "No se pudo subir la imagen" });
  }
}

// GET /seller/ml/products/search?q=texto — para la calculadora: buscar un producto real del
// catálogo y autocompletar peso + costo total en vez de cargarlos a mano.
export async function searchProducts(req, res) {
  try {
    const results = await listingSvc.searchProductsForCalculator(req.seller.id, req.query.q || "");
    return res.json(results);
  } catch (err) {
    console.error("[ml] searchProducts:", err.message);
    return res.status(500).json({ message: "Error" });
  }
}

// GET /seller/ml/products/:productId/price-floor
export async function getPriceFloor(req, res) {
  try {
    const floor = await listingSvc.getPriceFloor(req.seller.id, req.params.productId);
    return res.json({ floor });
  } catch (err) {
    console.error("[ml] getPriceFloor:", err.message);
    return res.status(err.status || 500).json({ message: err.message || "Error" });
  }
}

// POST /seller/ml/products/:productId/publish
export async function publishProduct(req, res) {
  try {
    const card = await walletSvc.getCardStatus(req.seller.id);
    if (!card.hasCard) {
      return res.status(400).json({ message: "Guardá una tarjeta antes de publicar en Mercado Libre" });
    }
    const listing = await listingSvc.publishProduct(req.seller.id, req.params.productId, req.body);
    return res.json(listing);
  } catch (err) {
    console.error("[ml] publishProduct:", err.message);
    return res.status(err.status || 500).json({ message: err.message || "Error" });
  }
}

// ── Combos de ML ─────────────────────────────────────────────

// POST /seller/ml/combos  { products: [{ productId, quantity }] }
export async function createCombo(req, res) {
  try {
    const result = await listingSvc.createCombo(req.seller.id, req.body.products || []);
    return res.json(result);
  } catch (err) {
    console.error("[ml] createCombo:", err.message);
    return res.status(err.status || 500).json({ message: err.message || "Error" });
  }
}

// GET /seller/ml/combos/:comboId
export async function getComboDetail(req, res) {
  try {
    return res.json(await listingSvc.getComboDetail(req.seller.id, req.params.comboId));
  } catch (err) {
    console.error("[ml] getComboDetail:", err.message);
    return res.status(err.status || 500).json({ message: err.message || "Error" });
  }
}

// PATCH /seller/ml/combos/:comboId  { products: [{ productId, quantity }] }
export async function updateComboQuantities(req, res) {
  try {
    const result = await listingSvc.updateComboQuantities(req.seller.id, req.params.comboId, req.body.products || []);
    return res.json(result);
  } catch (err) {
    console.error("[ml] updateComboQuantities:", err.message);
    return res.status(err.status || 500).json({ message: err.message || "Error" });
  }
}

// POST /seller/ml/combos/:comboId/publish
export async function publishCombo(req, res) {
  try {
    const card = await walletSvc.getCardStatus(req.seller.id);
    if (!card.hasCard) {
      return res.status(400).json({ message: "Guardá una tarjeta antes de publicar en Mercado Libre" });
    }
    const listing = await listingSvc.publishCombo(req.seller.id, req.params.comboId, req.body);
    return res.json(listing);
  } catch (err) {
    console.error("[ml] publishCombo:", err.message);
    return res.status(err.status || 500).json({ message: err.message || "Error" });
  }
}

// PATCH /seller/ml/listings/:mlItemId  { status }
export async function updateListingStatus(req, res) {
  try {
    if (req.body.status === "paused") await listingSvc.pauseListing(req.seller.id, req.params.mlItemId);
    else if (req.body.status === "active") await listingSvc.reactivateListing(req.seller.id, req.params.mlItemId);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[ml] updateListingStatus:", err.message);
    return res.status(err.status || 500).json({ message: err.message || "Error" });
  }
}

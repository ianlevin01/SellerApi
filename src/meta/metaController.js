import * as repo     from "./metaRepository.js";
import * as svc      from "./metaService.js";
import * as aiSvc    from "./metaAiService.js";

const SELLER_APP = process.env.SELLER_APP_URL || "https://ventaz.com.ar";
const REDIRECT_BASE = `${SELLER_APP}/publicidad`;

// GET /seller/meta/connect — genera la URL de OAuth y la devuelve al frontend
export async function getConnectUrl(req, res) {
  try {
    const state = await repo.createOAuthState(req.seller.id);
    const url   = svc.getOAuthUrl(state);
    return res.json({ url });
  } catch (err) {
    console.error("[meta] getConnectUrl:", err.message);
    return res.status(500).json({ message: "Error generando URL de conexión" });
  }
}

// GET /seller/meta/callback — Meta redirige aquí con code+state
export async function callback(req, res) {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`${REDIRECT_BASE}?meta_error=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return res.redirect(`${REDIRECT_BASE}?meta_error=missing_params`);
  }

  try {
    const sellerId = await repo.consumeOAuthState(state);
    if (!sellerId) {
      return res.redirect(`${REDIRECT_BASE}?meta_error=state_invalid`);
    }

    const shortToken              = await svc.exchangeCodeForToken(code);
    const { token, expiresAt }    = await svc.getLongLivedToken(shortToken);
    const { id: metaUserId, name: metaUserName } = await svc.getMetaUser(token);

    await repo.upsertConnection(sellerId, { token, expiresAt, metaUserId, metaUserName });

    return res.redirect(`${REDIRECT_BASE}?meta_connected=true`);
  } catch (err) {
    console.error("[meta] callback:", err.message);
    return res.redirect(`${REDIRECT_BASE}?meta_error=server_error`);
  }
}

// GET /seller/meta/status
export async function getStatus(req, res) {
  try {
    const conn = await repo.getConnection(req.seller.id);
    if (!conn) return res.json({ connected: false });
    return res.json({
      connected:        true,
      meta_user_name:   conn.meta_user_name,
      ad_account_id:    conn.ad_account_id,
      ad_account_name:  conn.ad_account_name,
      token_expires_at: conn.token_expires_at,
    });
  } catch (err) {
    console.error("[meta] getStatus:", err.message);
    return res.status(500).json({ message: "Error" });
  }
}

// GET /seller/meta/ad-accounts — lista las cuentas publicitarias del seller
export async function getAdAccounts(req, res) {
  try {
    const conn = await repo.getConnectionWithToken(req.seller.id);
    if (!conn) return res.status(400).json({ message: "Meta no conectado" });
    const accounts = await svc.getAdAccounts(conn.access_token);
    return res.json(accounts);
  } catch (err) {
    console.error("[meta] getAdAccounts:", err.message);
    return res.status(500).json({ message: "Error obteniendo cuentas publicitarias" });
  }
}

// POST /seller/meta/select-account — guarda qué cuenta publicitaria usa este seller
export async function selectAdAccount(req, res) {
  try {
    const { ad_account_id, ad_account_name } = req.body;
    if (!ad_account_id) return res.status(400).json({ message: "ad_account_id requerido" });
    await repo.setAdAccount(req.seller.id, ad_account_id, ad_account_name || null);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[meta] selectAdAccount:", err.message);
    return res.status(500).json({ message: "Error guardando cuenta" });
  }
}

// DELETE /seller/meta/disconnect
export async function disconnect(req, res) {
  try {
    await repo.deleteConnection(req.seller.id);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[meta] disconnect:", err.message);
    return res.status(500).json({ message: "Error" });
  }
}

// GET /seller/meta/pixels
export async function getSellerPixels(req, res) {
  try {
    const conn = await repo.getConnectionWithToken(req.seller.id);
    if (!conn) return res.status(400).json({ message: "Meta no conectado" });
    if (!conn.ad_account_id) return res.status(400).json({ message: "Sin cuenta publicitaria seleccionada" });
    const pixels = await svc.getPixels(conn.access_token, conn.ad_account_id);
    return res.json(pixels);
  } catch (err) {
    console.error("[meta] getSellerPixels:", err.message);
    return res.status(500).json({ message: err.message || "Error" });
  }
}

// GET /seller/meta/campaigns?date_preset=last_7d
export async function getMetaCampaigns(req, res) {
  try {
    const conn = await repo.getConnectionWithToken(req.seller.id);
    if (!conn) return res.status(400).json({ message: "Meta no conectado" });
    if (!conn.ad_account_id) return res.status(400).json({ message: "Sin cuenta publicitaria seleccionada" });
    const preset = req.query.date_preset || "last_7d";
    const [campaigns, insights] = await Promise.all([
      svc.getCampaigns(conn.access_token, conn.ad_account_id),
      svc.getCampaignsInsights(conn.access_token, conn.ad_account_id, preset),
    ]);
    const insightsMap = {};
    for (const i of insights) insightsMap[i.campaign_id] = i;
    const merged = campaigns.map(c => ({ ...c, insights: insightsMap[c.id] || null }));
    return res.json(merged);
  } catch (err) {
    console.error("[meta] getMetaCampaigns:", err.message);
    return res.status(500).json({ message: err.message || "Error" });
  }
}

// GET /seller/meta/insights?date_preset=last_7d
export async function getMetaInsights(req, res) {
  try {
    const conn = await repo.getConnectionWithToken(req.seller.id);
    if (!conn) return res.status(400).json({ message: "Meta no conectado" });
    if (!conn.ad_account_id) return res.status(400).json({ message: "Sin cuenta publicitaria seleccionada" });
    const preset   = req.query.date_preset || "last_7d";
    const insights = await svc.getAccountInsights(conn.access_token, conn.ad_account_id, preset);
    return res.json(insights || {});
  } catch (err) {
    console.error("[meta] getMetaInsights:", err.message);
    return res.status(500).json({ message: err.message || "Error" });
  }
}

// PATCH /seller/meta/campaigns/:id
export async function updateMetaCampaign(req, res) {
  try {
    const conn = await repo.getConnectionWithToken(req.seller.id);
    if (!conn) return res.status(400).json({ message: "Meta no conectado" });
    const { status, daily_budget_ars } = req.body;
    if (status !== undefined) {
      if (!["ACTIVE", "PAUSED"].includes(status)) return res.status(400).json({ message: "Status inválido" });
      await svc.setCampaignStatus(conn.access_token, req.params.id, status);
    }
    if (daily_budget_ars !== undefined) {
      await svc.setCampaignBudget(conn.access_token, req.params.id, Number(daily_budget_ars));
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("[meta] updateMetaCampaign:", err.message);
    return res.status(500).json({ message: err.message || "Error" });
  }
}

// POST /seller/meta/ai
export async function metaAi(req, res) {
  try {
    const { message, history = [] } = req.body;
    if (!message?.trim()) return res.status(400).json({ message: "message requerido" });
    const conn   = await repo.getConnectionWithToken(req.seller.id);
    const result = await aiSvc.runMetaAgent({ message, history, connection: conn || null });
    return res.json(result);
  } catch (err) {
    console.error("[meta] metaAi:", err.message);
    return res.status(500).json({ message: err.message || "Error" });
  }
}

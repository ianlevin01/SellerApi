import * as repo from "./metaRepository.js";
import * as svc  from "./metaService.js";

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
      connected:       true,
      meta_user_name:  conn.meta_user_name,
      ad_account_id:   conn.ad_account_id,
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
    const { ad_account_id } = req.body;
    if (!ad_account_id) return res.status(400).json({ message: "ad_account_id requerido" });
    await repo.setAdAccount(req.seller.id, ad_account_id);
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

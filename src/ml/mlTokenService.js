import * as repo from "./mlRepository.js";
import * as svc from "./mlService.js";

// Devuelve un access_token válido para el seller, renovándolo si está por vencer.
export async function getValidToken(sellerId) {
  const conn = await repo.getConnectionWithToken(sellerId);
  if (!conn) return null;

  const expiresInMs = new Date(conn.token_expires_at).getTime() - Date.now();
  if (expiresInMs > 5 * 60 * 1000) return conn.access_token; // todavía válido por +5min

  const refreshed = await svc.refreshAccessToken(conn.refresh_token);
  await repo.updateTokens(sellerId, refreshed);
  return refreshed.accessToken;
}

const APP_ID       = process.env.META_APP_ID;
const APP_SECRET   = process.env.META_APP_SECRET;
const REDIRECT_URI = process.env.META_REDIRECT_URI || "https://api.ventaz.online/seller/meta/callback";
const API_VERSION  = "v21.0";
const SCOPES       = "ads_management,ads_read,business_management";

export function getOAuthUrl(state) {
  const params = new URLSearchParams({
    client_id:     APP_ID,
    redirect_uri:  REDIRECT_URI,
    scope:         SCOPES,
    state,
    response_type: "code",
  });
  return `https://www.facebook.com/${API_VERSION}/dialog/oauth?${params}`;
}

async function graphGet(path, params) {
  const url = new URL(`https://graph.facebook.com/${API_VERSION}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res  = await fetch(url.toString());
  const data = await res.json();
  if (data.error) throw new Error(`Meta API: ${data.error.message}`);
  return data;
}

export async function exchangeCodeForToken(code) {
  const data = await graphGet("/oauth/access_token", {
    client_id:     APP_ID,
    client_secret: APP_SECRET,
    redirect_uri:  REDIRECT_URI,
    code,
  });
  return data.access_token;
}

export async function getLongLivedToken(shortToken) {
  const data = await graphGet("/oauth/access_token", {
    grant_type:       "fb_exchange_token",
    client_id:        APP_ID,
    client_secret:    APP_SECRET,
    fb_exchange_token: shortToken,
  });
  const expiresAt = data.expires_in
    ? new Date(Date.now() + Number(data.expires_in) * 1000)
    : null;
  return { token: data.access_token, expiresAt };
}

export async function getMetaUser(token) {
  const data = await graphGet("/me", { fields: "id,name", access_token: token });
  return { id: data.id, name: data.name };
}

export async function getAdAccounts(token) {
  const data = await graphGet("/me/adaccounts", {
    fields:       "id,name,currency,account_status",
    access_token: token,
  });
  return data.data || [];
}

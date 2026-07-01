const APP_ID       = process.env.META_APP_ID;
const APP_SECRET   = process.env.META_APP_SECRET;
const REDIRECT_URI = process.env.META_REDIRECT_URI || "https://api.ventaz.online/seller/meta/callback";
const API_VERSION  = "v21.0";
const SCOPES       = "ads_management,ads_read,business_management,pages_show_list";

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

async function graphPost(path, params, token) {
  const url = new URL(`https://graph.facebook.com/${API_VERSION}${path}`);
  url.searchParams.set("access_token", token);
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined) continue;
    form.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  const res = await fetch(url.toString(), {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    form.toString(),
  });
  const data = await res.json();
  if (data.error) {
    console.error("[metaService] POST error", path, JSON.stringify(data.error));
    throw new Error(`Meta API: ${data.error.message}`);
  }
  return data;
}

export async function getCampaigns(token, adAccountId) {
  const data = await graphGet(`/${adAccountId}/campaigns`, {
    fields:       "id,name,status,daily_budget,lifetime_budget,start_time,stop_time,objective,created_time",
    access_token: token,
    limit:        50,
  });
  return data.data || [];
}

export async function getAccountInsights(token, adAccountId, datePreset = "last_7d") {
  const data = await graphGet(`/${adAccountId}/insights`, {
    fields:      "impressions,clicks,ctr,spend,reach,actions",
    date_preset: datePreset,
    access_token: token,
  });
  return data.data?.[0] || null;
}

export async function getCampaignsInsights(token, adAccountId, datePreset = "last_7d") {
  const data = await graphGet(`/${adAccountId}/insights`, {
    fields:       "campaign_id,campaign_name,impressions,clicks,ctr,spend,reach,cpc,actions",
    date_preset:  datePreset,
    level:        "campaign",
    access_token: token,
    limit:        50,
  });
  return data.data || [];
}

export async function setCampaignStatus(token, campaignId, status) {
  return graphPost(`/${campaignId}`, { status }, token);
}

export async function setCampaignBudget(token, campaignId, dailyBudgetArs) {
  const cents = Math.round(dailyBudgetArs * 100);
  return graphPost(`/${campaignId}`, { daily_budget: cents }, token);
}

export async function createCampaign(token, adAccountId, { name, objective, status = "PAUSED", daily_budget_ars }) {
  const body = {
    name,
    objective,
    status,
    special_ad_categories: [],
    is_adset_budget_sharing_enabled: daily_budget_ars ? true : false,
  };
  if (daily_budget_ars) body.daily_budget = Math.round(daily_budget_ars * 100);
  return graphPost(`/${adAccountId}/campaigns`, body, token);
}

export async function getAdSets(token, adAccountId, campaignId) {
  const params = {
    fields:       "id,name,status,daily_budget,optimization_goal,billing_event,targeting,start_time,end_time,promoted_object",
    access_token: token,
    limit:        50,
  };
  if (campaignId) params.campaign_id = campaignId;
  const data = await graphGet(`/${adAccountId}/adsets`, params);
  return data.data || [];
}

export async function createAdSet(token, adAccountId, params) {
  const GOAL_MAP = {
    OUTCOME_SALES:      "OFFSITE_CONVERSIONS",
    OUTCOME_TRAFFIC:    params.optimization_goal || "LANDING_PAGE_VIEWS",
    OUTCOME_AWARENESS:  "REACH",
    OUTCOME_LEADS:      "LEAD_GENERATION",
    OUTCOME_ENGAGEMENT: "POST_ENGAGEMENT",
  };

  const ageMax = params.age_max && params.age_max < 65 ? params.age_max : undefined;
  const useInstagram = params.use_instagram !== false;
  const targeting = {
    geo_locations:        { countries: params.countries || ["AR"] },
    age_min:              params.age_min || 18,
    ...(ageMax ? { age_max: ageMax } : {}),
    publisher_platforms:  useInstagram ? ["facebook", "instagram"] : ["facebook"],
    facebook_positions:   ["feed", "story", "facebook_reels"],
    ...(useInstagram ? { instagram_positions: ["stream", "story", "reels"] } : {}),
    targeting_automation: { advantage_audience: 0 },
  };
  if (params.genders === "male")   targeting.genders = [1];
  if (params.genders === "female") targeting.genders = [2];
  if (params.interests?.length)    targeting.flexible_spec = [{ interests: params.interests }];

  const body = {
    campaign_id:       params.campaign_id,
    name:              params.name,
    billing_event:     "IMPRESSIONS",
    optimization_goal: params.optimization_goal || GOAL_MAP[params.campaign_objective] || "LINK_CLICKS",
    bid_strategy:      "LOWEST_COST_WITHOUT_CAP",
    daily_budget:      Math.round((params.daily_budget_ars || 1000) * 100),
    targeting,
    status:            params.status || "PAUSED",
    destination_type:  "WEBSITE",
  };

  if (params.pixel_id && params.conversion_event) {
    body.promoted_object = { pixel_id: params.pixel_id, custom_event_type: params.conversion_event };
  }
  if (params.start_time) body.start_time = params.start_time;
  if (params.end_time)   body.end_time   = params.end_time;

  return graphPost(`/${adAccountId}/adsets`, body, token);
}

export async function updateAdSet(token, adSetId, { status, daily_budget_ars, name }) {
  const body = {};
  if (status)          body.status        = status;
  if (daily_budget_ars) body.daily_budget = Math.round(daily_budget_ars * 100);
  if (name)            body.name          = name;
  return graphPost(`/${adSetId}`, body, token);
}

export async function getPages(token) {
  const data = await graphGet("/me/accounts", {
    fields:       "id,name",
    access_token: token,
    limit:        50,
  });
  return data.data || [];
}

export async function getPixels(token, adAccountId) {
  const data = await graphGet(`/${adAccountId}/adspixels`, {
    fields:       "id,name",
    access_token: token,
  });
  return data.data || [];
}

export async function getAdImages(token, adAccountId) {
  const data = await graphGet(`/${adAccountId}/adimages`, {
    fields:       "hash,url,name,status",
    access_token: token,
    limit:        50,
  });
  return data.data || [];
}

export async function searchInterests(token, query) {
  const data = await graphGet("/search", {
    type:         "adinterest",
    q:            query,
    access_token: token,
    limit:        10,
  });
  return data.data || [];
}

export async function createAdCreative(token, adAccountId, params) {
  const link_data = {
    link:    params.link,
    message: params.message,
    name:    params.headline,
    call_to_action: {
      type:  params.cta_type || "SHOP_NOW",
      value: { link: params.link },
    },
  };
  if (params.image_hash) link_data.image_hash = params.image_hash;
  else if (params.image_url) link_data.picture = params.image_url;
  if (params.description) link_data.description = params.description;

  return graphPost(`/${adAccountId}/adcreatives`, {
    name:               params.name,
    object_story_spec:  { page_id: params.page_id, link_data },
  }, token);
}

export async function createAd(token, adAccountId, params) {
  return graphPost(`/${adAccountId}/ads`, {
    name:        params.name,
    campaign_id: params.campaign_id,
    adset_id:    params.adset_id,
    creative:    { creative_id: params.creative_id },
    status:      params.status || "PAUSED",
  }, token);
}

export async function getAds(token, adAccountId, adsetId) {
  const params = { fields: "id,name,status,creative{id,name}", access_token: token, limit: 50 };
  if (adsetId) params.adset_id = adsetId;
  const data = await graphGet(`/${adAccountId}/ads`, params);
  return data.data || [];
}

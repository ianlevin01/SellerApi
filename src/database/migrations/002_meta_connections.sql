-- Estados temporales del OAuth flow (expiran en 10 minutos)
CREATE TABLE meta_oauth_states (
  state      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id  UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used       BOOLEAN NOT NULL DEFAULT false
);

-- Conexiones Meta por seller (token de larga duración ~60 días)
CREATE TABLE meta_connections (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id        UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  access_token     TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  meta_user_id     TEXT,
  meta_user_name   TEXT,
  ad_account_id    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(seller_id)
);

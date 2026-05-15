ALTER TABLE sellers
  ADD COLUMN IF NOT EXISTS reset_token            text,
  ADD COLUMN IF NOT EXISTS reset_token_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS sellers_reset_token_idx ON sellers (reset_token)
  WHERE reset_token IS NOT NULL;

ALTER TABLE sellers
  ADD COLUMN IF NOT EXISTS reset_token          TEXT,
  ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMPTZ;

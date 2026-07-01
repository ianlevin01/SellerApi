ALTER TABLE meta_connections
  ADD COLUMN IF NOT EXISTS ad_account_name text;

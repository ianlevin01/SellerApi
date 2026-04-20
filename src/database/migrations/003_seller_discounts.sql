-- Migration 003: Progressive discounts per seller

CREATE TABLE IF NOT EXISTS seller_discounts (
  id             SERIAL PRIMARY KEY,
  seller_id      UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  enabled        BOOLEAN NOT NULL DEFAULT false,
  discount_type  VARCHAR(10) NOT NULL DEFAULT 'quantity',
  min_profit_pct NUMERIC(5,2) NOT NULL DEFAULT 10,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(seller_id)
);

CREATE TABLE IF NOT EXISTS seller_discount_tiers (
  id           SERIAL PRIMARY KEY,
  seller_id    UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  threshold    NUMERIC(14,2) NOT NULL,
  discount_pct NUMERIC(5,2) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seller_discount_tiers_seller
  ON seller_discount_tiers(seller_id, threshold);

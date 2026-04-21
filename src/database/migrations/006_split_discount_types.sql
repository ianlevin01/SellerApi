-- Migration 006: Separate quantity and price discount configs

ALTER TABLE seller_discounts
  ADD COLUMN IF NOT EXISTS enabled_quantity BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS enabled_price    BOOLEAN NOT NULL DEFAULT false;

-- Migrate existing enabled flag
UPDATE seller_discounts SET enabled_quantity = enabled WHERE discount_type = 'quantity';
UPDATE seller_discounts SET enabled_price    = enabled WHERE discount_type = 'price';

ALTER TABLE seller_discount_tiers
  ADD COLUMN IF NOT EXISTS discount_type VARCHAR(10) NOT NULL DEFAULT 'quantity';

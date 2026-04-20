-- Migration 004: Add social / contact fields to seller_pages
ALTER TABLE seller_pages
  ADD COLUMN IF NOT EXISTS tagline    VARCHAR(160),
  ADD COLUMN IF NOT EXISTS whatsapp   VARCHAR(30),
  ADD COLUMN IF NOT EXISTS instagram  VARCHAR(60),
  ADD COLUMN IF NOT EXISTS facebook   VARCHAR(120);

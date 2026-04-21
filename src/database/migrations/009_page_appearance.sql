-- Migration 009: Logo, typography, extra colors, category filter per page
ALTER TABLE seller_pages
  ADD COLUMN IF NOT EXISTS logo_url            VARCHAR(500),
  ADD COLUMN IF NOT EXISTS font_family         VARCHAR(80),
  ADD COLUMN IF NOT EXISTS color_secondary     VARCHAR(7),
  ADD COLUMN IF NOT EXISTS color_bg            VARCHAR(7),
  ADD COLUMN IF NOT EXISTS color_text          VARCHAR(7),
  ADD COLUMN IF NOT EXISTS featured_categories JSONB;

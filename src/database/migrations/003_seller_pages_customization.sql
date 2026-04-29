-- Extended customization fields for seller_pages
ALTER TABLE seller_pages
  ADD COLUMN IF NOT EXISTS logo_url          text,
  ADD COLUMN IF NOT EXISTS font_family       text,
  ADD COLUMN IF NOT EXISTS color_secondary   text,
  ADD COLUMN IF NOT EXISTS color_bg          text,
  ADD COLUMN IF NOT EXISTS color_text        text,
  ADD COLUMN IF NOT EXISTS featured_categories jsonb,
  ADD COLUMN IF NOT EXISTS card_border_radius  integer DEFAULT 16,
  ADD COLUMN IF NOT EXISTS card_show_shadow    boolean DEFAULT true;

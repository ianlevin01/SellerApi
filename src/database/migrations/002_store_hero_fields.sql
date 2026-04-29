-- New configurable fields for the public store
ALTER TABLE seller_pages
  ADD COLUMN IF NOT EXISTS hero_headline  text,
  ADD COLUMN IF NOT EXISTS hero_image_url text,
  ADD COLUMN IF NOT EXISTS promo_text     text DEFAULT '🚀 Envíos a todo el país · 💳 Pago seguro · 📦 Stock disponible · ⭐ Los mejores precios',
  ADD COLUMN IF NOT EXISTS show_promo_bar boolean DEFAULT true;

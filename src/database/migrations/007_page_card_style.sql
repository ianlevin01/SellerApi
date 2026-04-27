ALTER TABLE seller_pages ADD COLUMN IF NOT EXISTS card_border_radius smallint DEFAULT 12;
ALTER TABLE seller_pages ADD COLUMN IF NOT EXISTS card_show_shadow boolean DEFAULT true;

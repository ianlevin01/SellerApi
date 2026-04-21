-- Migration 007: Allow multiple pages per seller; move discounts to page scope

-- Add page_name (display label in the panel UI)
ALTER TABLE seller_pages
  ADD COLUMN IF NOT EXISTS page_name VARCHAR(80);
UPDATE seller_pages SET page_name = store_name WHERE page_name IS NULL;

-- Remove the seller-level unique constraint so sellers can have multiple pages
ALTER TABLE seller_pages
  DROP CONSTRAINT IF EXISTS seller_pages_seller_id_key;

-- Link discount config to a specific page (seller_pages.id is UUID)
ALTER TABLE seller_discounts
  ADD COLUMN IF NOT EXISTS page_id UUID REFERENCES seller_pages(id) ON DELETE CASCADE;
UPDATE seller_discounts sd
  SET page_id = (SELECT id FROM seller_pages sp WHERE sp.seller_id = sd.seller_id LIMIT 1)
  WHERE page_id IS NULL;
ALTER TABLE seller_discounts
  DROP CONSTRAINT IF EXISTS seller_discounts_seller_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS seller_discounts_page_id_key ON seller_discounts(page_id);

-- Link discount tiers to a specific page
ALTER TABLE seller_discount_tiers
  ADD COLUMN IF NOT EXISTS page_id UUID REFERENCES seller_pages(id) ON DELETE CASCADE;
UPDATE seller_discount_tiers sdt
  SET page_id = (SELECT id FROM seller_pages sp WHERE sp.seller_id = sdt.seller_id LIMIT 1)
  WHERE page_id IS NULL;

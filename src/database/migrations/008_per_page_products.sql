-- Migration 008: Products become per-page

ALTER TABLE seller_products
  ADD COLUMN IF NOT EXISTS page_id UUID REFERENCES seller_pages(id) ON DELETE CASCADE;

-- Point existing rows to each seller's first page
UPDATE seller_products sp
  SET page_id = (SELECT id FROM seller_pages pg WHERE pg.seller_id = sp.seller_id LIMIT 1)
  WHERE page_id IS NULL;

-- Replace seller-level unique constraint with page-level
ALTER TABLE seller_products
  DROP CONSTRAINT IF EXISTS seller_products_seller_id_product_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS seller_products_page_id_product_id_key
  ON seller_products(page_id, product_id);

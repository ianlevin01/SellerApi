-- Shipping configuration per seller page
ALTER TABLE seller_pages
  ADD COLUMN IF NOT EXISTS costo_envio numeric NOT NULL DEFAULT 0;

-- Free shipping toggle per product (per seller page)
ALTER TABLE seller_products
  ADD COLUMN IF NOT EXISTS free_shipping boolean NOT NULL DEFAULT false;

-- Free shipping toggle per combo
ALTER TABLE page_combos
  ADD COLUMN IF NOT EXISTS free_shipping boolean NOT NULL DEFAULT false;

-- Track how much shipping the seller absorbed (for earnings deduction)
ALTER TABLE web_orders
  ADD COLUMN IF NOT EXISTS free_shipping_absorbed numeric NOT NULL DEFAULT 0;

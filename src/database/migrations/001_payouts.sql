-- CVU fields on sellers
ALTER TABLE sellers
  ADD COLUMN IF NOT EXISTS cvu              text,
  ADD COLUMN IF NOT EXISTS cvu_alias        text,
  ADD COLUMN IF NOT EXISTS cvu_holder_name  text,
  ADD COLUMN IF NOT EXISTS cvu_verified     boolean DEFAULT false;

-- Earnings per paid order (one row per web_order)
CREATE TABLE IF NOT EXISTS seller_earnings (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id    uuid        NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  web_order_id uuid        NOT NULL UNIQUE REFERENCES web_orders(id) ON DELETE CASCADE,
  amount       numeric(12,2) NOT NULL DEFAULT 0,
  status       text        NOT NULL DEFAULT 'pending_approval',
  payout_id    uuid,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seller_earnings_seller_status
  ON seller_earnings (seller_id, status);

-- Payout requests (one per transfer request)
CREATE TABLE IF NOT EXISTS seller_payouts (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id      uuid        NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  amount         numeric(12,2) NOT NULL,
  cvu            text        NOT NULL,
  status         text        NOT NULL DEFAULT 'en_proceso',
  created_at     timestamptz DEFAULT now(),
  transferred_at timestamptz
);

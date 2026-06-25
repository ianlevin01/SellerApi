-- Tipo de orden: NULL = compra normal, 'seller_request' = vendedor solicita producto, 'stock_reserve' = reserva de stock
ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS order_type VARCHAR(50);

-- Cantidad de unidades de este ítem que se sirvieron del stock propio del vendedor
ALTER TABLE web_order_items ADD COLUMN IF NOT EXISTS seller_stock_used INTEGER NOT NULL DEFAULT 0;

-- Reservas de stock por vendedor (stock exclusivo pre-comprado)
CREATE TABLE IF NOT EXISTS seller_stock_reserves (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id  UUID    NOT NULL REFERENCES sellers(id)  ON DELETE CASCADE,
  product_id UUID    NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity   INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (seller_id, product_id)
);

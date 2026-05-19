-- Almacena el costo base (tier 30%) por ítem al momento del checkout.
-- Evita que cambios en la cotización del dólar alteren el cálculo de ganancias.
ALTER TABLE web_order_items
  ADD COLUMN IF NOT EXISTS unit_cost numeric(12,2);

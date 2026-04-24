-- Agrega columna para guardar el ID de pago de MercadoPago en web_orders
ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS mp_payment_id TEXT;

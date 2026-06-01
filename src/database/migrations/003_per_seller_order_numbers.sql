-- Desvincula el campo numero de la secuencia global para que
-- cada vendedor tenga su propia numeración correlativa (1, 2, 3...).
-- A partir de esta migración, el numero se calcula en la aplicación
-- como MAX(numero) + 1 WHERE seller_id = ? dentro de la transacción.
ALTER TABLE web_orders ALTER COLUMN numero DROP DEFAULT;

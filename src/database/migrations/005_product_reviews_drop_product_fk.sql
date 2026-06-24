-- product_reviews.product_id es usado también para IDs de combos (page_combos).
-- Eliminamos la FK a products para permitir reseñas en ambos tipos.
ALTER TABLE product_reviews DROP CONSTRAINT IF EXISTS product_reviews_product_id_fkey;

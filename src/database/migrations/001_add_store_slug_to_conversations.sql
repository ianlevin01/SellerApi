-- Add store_slug to both conversation tables so reply emails link to the correct store

ALTER TABLE consumer_conversations ADD COLUMN IF NOT EXISTS store_slug TEXT;
ALTER TABLE conversations          ADD COLUMN IF NOT EXISTS store_slug TEXT;

-- Backfill sellers that only have ONE active store (safe: only one possible slug)
UPDATE consumer_conversations cc
SET    store_slug = sp.slug
FROM   seller_pages sp
WHERE  cc.seller_id  = sp.seller_id
  AND  cc.store_slug IS NULL
  AND  sp.active     = true
  AND  (SELECT COUNT(*) FROM seller_pages sp2
        WHERE sp2.seller_id = cc.seller_id AND sp2.active = true) = 1;

UPDATE conversations c
SET    store_slug = sp.slug
FROM   seller_pages sp
WHERE  c.seller_id   = sp.seller_id
  AND  c.store_slug  IS NULL
  AND  sp.active     = true
  AND  (SELECT COUNT(*) FROM seller_pages sp2
        WHERE sp2.seller_id = c.seller_id AND sp2.active = true) = 1;

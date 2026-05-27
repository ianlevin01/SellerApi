-- Campos de perfil extendido para la tabla sellers

ALTER TABLE sellers
  ADD COLUMN IF NOT EXISTS first_name  TEXT,
  ADD COLUMN IF NOT EXISTS last_name   TEXT,
  ADD COLUMN IF NOT EXISTS birth_date  DATE;

-- Backfill first_name / last_name a partir del campo name existente
UPDATE sellers
SET
  first_name = TRIM(SPLIT_PART(name, ' ', 1)),
  last_name  = TRIM(SUBSTRING(name FROM POSITION(' ' IN name) + 1))
WHERE name IS NOT NULL
  AND name <> ''
  AND first_name IS NULL;

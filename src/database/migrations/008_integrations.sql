CREATE TABLE IF NOT EXISTS integrations (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  key         text UNIQUE NOT NULL,
  name        text NOT NULL,
  description text,
  icon        text,
  active      boolean DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seller_integrations (
  page_id        uuid NOT NULL REFERENCES seller_pages(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  active         boolean DEFAULT false,
  config         jsonb DEFAULT '{}',
  PRIMARY KEY (page_id, integration_id)
);

INSERT INTO integrations (key, name, description, icon) VALUES
  ('meta_pixel', 'Meta Pixel',
   'Conectá tu tienda con Meta (Facebook/Instagram) para medir visitas, carritos y ventas de tus campañas publicitarias.',
   '📊'),
  ('star_ai', 'StarAI — Reseñas',
   'Generá reseñas auténticas con inteligencia artificial para tus productos y aumentá la confianza de tus clientes.',
   '⭐')
ON CONFLICT (key) DO NOTHING;

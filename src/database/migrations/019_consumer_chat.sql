CREATE TABLE IF NOT EXISTS consumer_conversations (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id       uuid REFERENCES sellers(id) ON DELETE SET NULL,
  consumer_email  text NOT NULL,
  consumer_name   text NOT NULL,
  consumer_phone  text,
  access_token    text NOT NULL,
  subject         text,
  order_items     jsonb  DEFAULT '[]',
  grand_total     numeric(12,2) DEFAULT 0,
  shipping_info   jsonb  DEFAULT '{}',
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS consumer_messages (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES consumer_conversations(id) ON DELETE CASCADE,
  sender          text NOT NULL CHECK (sender IN ('admin', 'consumer')),
  body            text NOT NULL,
  created_at      timestamptz DEFAULT now(),
  read_at         timestamptz
);

CREATE INDEX IF NOT EXISTS consumer_messages_conv_idx ON consumer_messages (conversation_id, created_at);

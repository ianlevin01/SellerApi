-- Migration 005: Chat tables + quote system

CREATE TABLE IF NOT EXISTS conversations (
  id             SERIAL PRIMARY KEY,
  seller_id      UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  customer_name  VARCHAR(120) NOT NULL,
  customer_email VARCHAR(120),
  customer_phone VARCHAR(30),
  access_token   VARCHAR(80) NOT NULL UNIQUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id               SERIAL PRIMARY KEY,
  conversation_id  INT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender           VARCHAR(10) NOT NULL CHECK (sender IN ('customer', 'seller')),
  body             TEXT NOT NULL,
  msg_type         VARCHAR(20) NOT NULL DEFAULT 'text',
  quote_data       JSONB,
  read_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent: add columns if tables already exist from a previous manual creation
ALTER TABLE messages ADD COLUMN IF NOT EXISTS msg_type   VARCHAR(20) NOT NULL DEFAULT 'text';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS quote_data JSONB;

CREATE INDEX IF NOT EXISTS idx_conversations_seller ON conversations(seller_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);

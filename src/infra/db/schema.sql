-- Enable UUID generation (available in PostgreSQL 13+ without pgcrypto via gen_random_uuid)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Traders registry
CREATE TABLE IF NOT EXISTS traders (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  address          TEXT         UNIQUE NOT NULL,
  tag              TEXT,
  copy_percentage  NUMERIC(5, 2),
  created_at       TIMESTAMPTZ  DEFAULT NOW()
);

-- Bot state: single-row table, always id = 1
CREATE TABLE IF NOT EXISTS bot_state (
  id            INT  PRIMARY KEY,
  active_trader TEXT
);

-- Seed the single bot_state row (idempotent)
INSERT INTO bot_state (id, active_trader)
VALUES (1, NULL)
ON CONFLICT (id) DO NOTHING;

-- Migration: add suggestions table
-- Run with: wrangler d1 execute calorie-tracker-sync --file=migrate_suggestions.sql --remote

CREATE TABLE IF NOT EXISTS suggestions (
  sync_id   TEXT PRIMARY KEY,
  token     TEXT NOT NULL,
  body      TEXT NOT NULL,
  status    TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_suggestions_token   ON suggestions(token);
CREATE INDEX IF NOT EXISTS idx_suggestions_updated ON suggestions(updated_at);

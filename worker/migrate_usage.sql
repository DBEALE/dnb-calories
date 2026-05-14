-- Migration: add usage tracking table
-- Run with: wrangler d1 execute calorie-tracker-sync --file=migrate_usage.sql --remote

CREATE TABLE IF NOT EXISTS usage (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  token     TEXT    NOT NULL,
  endpoint  TEXT    NOT NULL,
  model     TEXT,
  success   INTEGER NOT NULL DEFAULT 1,
  ts        TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_token_ts ON usage(token, ts);
CREATE INDEX IF NOT EXISTS idx_usage_ts       ON usage(ts);

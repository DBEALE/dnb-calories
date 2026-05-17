-- Migration: add settings table for admin-configurable values
-- Run with: wrangler d1 execute calorie-tracker-sync --file=migrate_settings.sql --remote

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Default quota: 30 AI requests per month per user
INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('quota_requests', '30',    datetime('now')),
  ('quota_period',   'month', datetime('now'));

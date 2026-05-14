-- D1 schema for calorie tracker sync
-- Apply with: wrangler d1 execute calorie-tracker-sync --file=schema.sql

CREATE TABLE IF NOT EXISTS food_entries (
  sync_id            TEXT PRIMARY KEY,
  token              TEXT NOT NULL,
  date               TEXT,
  time               TEXT,
  meal_type          TEXT,
  food_name          TEXT,
  brand              TEXT,
  serving_description TEXT,
  calories           REAL,
  protein_g          REAL,
  carbs_g            REAL,
  fat_g              REAL,
  fibre_g            REAL,
  salt_g             REAL,
  sugar_g            REAL,
  source_type        TEXT,
  ocr_confidence     REAL,
  updated_at         TEXT NOT NULL,
  deleted            INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS weight_entries (
  sync_id    TEXT PRIMARY KEY,
  token      TEXT NOT NULL,
  date       TEXT,
  time       TEXT,
  weight_kg  REAL,
  is_morning INTEGER,
  note       TEXT,
  updated_at TEXT NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS favourites (
  sync_id             TEXT PRIMARY KEY,
  token               TEXT NOT NULL,
  food_name           TEXT,
  brand               TEXT,
  serving_description TEXT,
  calories            REAL,
  protein_g           REAL,
  carbs_g             REAL,
  fat_g               REAL,
  fibre_g             REAL,
  salt_g              REAL,
  meal_type           TEXT,
  updated_at          TEXT NOT NULL,
  deleted             INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS profile (
  token      TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_food_token_updated   ON food_entries(token, updated_at);
CREATE INDEX IF NOT EXISTS idx_weight_token_updated ON weight_entries(token, updated_at);
CREATE INDEX IF NOT EXISTS idx_favs_token_updated   ON favourites(token, updated_at);

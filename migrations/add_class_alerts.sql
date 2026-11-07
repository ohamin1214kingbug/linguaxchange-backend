-- "Tell me when a Korean A2 class is posted." One row per member per
-- language and level; level '' means any level. Same junction-table shape as
-- saved_teachers: the row is the whole fact, so the composite key dedupes and
-- gives upsert-on-conflict for free.
CREATE TABLE IF NOT EXISTS class_alerts (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  language_code TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, language_code, level)
);

-- Looked up by language every time a class is published.
CREATE INDEX IF NOT EXISTS class_alerts_language_idx ON class_alerts (language_code);

ALTER TABLE class_alerts ENABLE ROW LEVEL SECURITY;

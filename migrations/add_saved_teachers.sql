-- A student's bookmark list. Junction table, same shape as
-- class_request_interest — the pair itself (who saved whom) is the whole
-- row, so a composite PK both dedupes and gives upsert-on-conflict for free.
CREATE TABLE IF NOT EXISTS saved_teachers (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, teacher_id)
);

ALTER TABLE saved_teachers ENABLE ROW LEVEL SECURITY;

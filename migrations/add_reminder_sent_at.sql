ALTER TABLE class_sessions
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_class_sessions_reminder_lookup
  ON class_sessions (session_date, reminder_sent_at, status);

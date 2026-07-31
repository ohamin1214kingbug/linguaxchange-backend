CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('student_joined', 'class_starting_soon', 'class_started')),
  class_session_id INTEGER REFERENCES class_sessions(id),
  message TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_id_created_at_idx ON notifications(user_id, created_at DESC);

-- Atomic-claim columns, same pattern as class_sessions.reminder_sent_at:
-- the cron sets these before notifying so an overlapping run can't double-send.
ALTER TABLE class_sessions ADD COLUMN IF NOT EXISTS starting_soon_notified_at TIMESTAMPTZ;
ALTER TABLE class_sessions ADD COLUMN IF NOT EXISTS live_notified_at TIMESTAMPTZ;

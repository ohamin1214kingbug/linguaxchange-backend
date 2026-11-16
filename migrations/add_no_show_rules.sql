-- No-show rules (owner, 2026-11-16). Who actually entered the video room
-- decides, not anyone's word (utils/noShow.js).

-- First time each person opened a session's room (their room token was
-- issued). One row per person per session.
CREATE TABLE IF NOT EXISTS room_joins (
  session_id INTEGER NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, user_id)
);
ALTER TABLE room_joins ENABLE ROW LEVEL SECURITY;

-- Strikes. Counted over the last 30 days; an admin can undo one.
CREATE TABLE IF NOT EXISTS no_show_events (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id INTEGER REFERENCES class_sessions(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  undone_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS no_show_events_user_idx ON no_show_events (user_id, created_at DESC);
ALTER TABLE no_show_events ENABLE ROW LEVEL SECURITY;

-- Claim columns for the cron checks, so a session is judged once.
ALTER TABLE class_sessions ADD COLUMN IF NOT EXISTS teacher_checked_at TIMESTAMPTZ;
ALTER TABLE class_sessions ADD COLUMN IF NOT EXISTS students_checked_at TIMESTAMPTZ;

-- A student who booked and never came.
ALTER TABLE class_enrollments ADD COLUMN IF NOT EXISTS no_show_at TIMESTAMPTZ;

-- The consequences.
ALTER TABLE users ADD COLUMN IF NOT EXISTS teaching_paused_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS booking_limited_until TIMESTAMPTZ;

-- notifications.type is a closed CHECK list; every type so far, plus one.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('student_joined', 'class_starting_soon', 'class_started',
                  'request_fulfilled', 'credit_added', 'assignment_answered',
                  'account_approved', 'class_ended', 'chat_message',
                  'request_offer', 'request_chat', 'no_show'));

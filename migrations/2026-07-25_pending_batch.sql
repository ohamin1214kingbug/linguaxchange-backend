-- Combined run of all migrations pending as of 2026-07-25. Run this once in
-- the Supabase SQL editor. Each block also exists as its own file
-- (add_streak_columns.sql, add_low_credit_notified_at.sql,
-- add_reminder_sent_at.sql) if you'd rather run them individually or want
-- the per-feature history — this file just bundles them for convenience.

-- Weekly Activity Streaks
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS current_streak INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS longest_streak INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_active_week DATE;

-- Low-Credit Nudge Email
ALTER TABLE credits
  ADD COLUMN IF NOT EXISTS low_credit_notified_at TIMESTAMPTZ;

-- Class Reminder Email
ALTER TABLE class_sessions
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_class_sessions_reminder_lookup
  ON class_sessions (session_date, reminder_sent_at, status);

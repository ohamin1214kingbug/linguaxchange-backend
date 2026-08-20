-- JSONB rather than a boolean column per toggle: this is the first
-- notification preference, more will follow the same shape, and JSONB means
-- a new one is a key addition instead of a migration. Only "low_credit_nudge"
-- ships in the default for now — no key for a feature (waitlist) that
-- doesn't exist yet.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notification_preferences JSONB NOT NULL
  DEFAULT '{"low_credit_nudge": true}'::jsonb;

-- timezone_source distinguishes "we guessed this from the browser" from
-- "the user picked this", so the login-time auto-detect sync can stop
-- clobbering a deliberate choice.
--
-- time_format is NULL by default on purpose: NULL means "no preference,
-- derive from the viewer's locale" (what Intl already does today), which is
-- a different state from an explicit 12h/24h choice.
--
-- text + CHECK rather than a Postgres ENUM: adding a value to an enum needs
-- its own migration, text doesn't, and this schema already uses text for
-- small fixed sets (teach_level, credit_transactions.type).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS timezone_source TEXT NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS time_format TEXT;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_timezone_source_check;
ALTER TABLE users
  ADD CONSTRAINT users_timezone_source_check
  CHECK (timezone_source IN ('auto', 'manual'));

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_time_format_check;
ALTER TABLE users
  ADD CONSTRAINT users_time_format_check
  CHECK (time_format IS NULL OR time_format IN ('12h', '24h'));

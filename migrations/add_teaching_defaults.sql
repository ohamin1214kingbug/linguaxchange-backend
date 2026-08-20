-- Nullable, same as time_format: NULL means "no saved default", which is
-- how the create-class form knows to fall back to its own hardcoded
-- default instead of forcing a value on teachers who skip this.
--
-- CHECK constraints mirror the create-class form's own dropdown options
-- (app/classes/create/page.js) rather than the looser >0 validation the
-- classes table itself uses — these are meant to be one of a fixed set of
-- choices, not an arbitrary number.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS default_class_duration_minutes SMALLINT,
  ADD COLUMN IF NOT EXISTS default_max_students SMALLINT;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_default_class_duration_minutes_check;
ALTER TABLE users
  ADD CONSTRAINT users_default_class_duration_minutes_check
  CHECK (default_class_duration_minutes IS NULL OR default_class_duration_minutes IN (30, 45, 60, 90));

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_default_max_students_check;
ALTER TABLE users
  ADD CONSTRAINT users_default_max_students_check
  CHECK (default_max_students IS NULL OR default_max_students BETWEEN 3 AND 10);

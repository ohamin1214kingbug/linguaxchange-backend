-- Three places disagreed about how big a class may be:
--   class_requests  CHECK 1..20
--   classes         CHECK 3..10
--   create form     3..10
--
-- A student could post a request for 1, 2, or 11-20 students, and it saved
-- fine — then the moment a teacher answered it, creating the class failed
-- on classes_max_students_check and the request looked auto-rejected.
--
-- Unified on 1..6 for both tables:
--   1-2 because one-to-one and pair tutoring are real offerings students
--   were already asking for, and the credit maths is unchanged (each
--   student spends one credit, the teacher earns one per attendee).
--   6 because these are live video conversation classes — an hour split
--   six ways is already only ten minutes of speaking time each, and 6 was
--   the create form's own default, so it matches the existing norm.
--
-- Checked before writing this: every existing row in both tables is within
-- 1..6, so these constraints validate cleanly rather than failing on
-- historic data.
ALTER TABLE classes
  DROP CONSTRAINT IF EXISTS classes_max_students_check;
ALTER TABLE classes
  ADD CONSTRAINT classes_max_students_check
  CHECK (max_students BETWEEN 1 AND 6);

ALTER TABLE class_requests
  DROP CONSTRAINT IF EXISTS class_requests_max_students_check;
ALTER TABLE class_requests
  ADD CONSTRAINT class_requests_max_students_check
  CHECK (max_students BETWEEN 1 AND 6);

-- A teacher's saved default class size has to sit inside the same range,
-- or the Teaching Defaults setting would offer sizes no class could use.
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_default_max_students_check;
ALTER TABLE users
  ADD CONSTRAINT users_default_max_students_check
  CHECK (default_max_students IS NULL OR default_max_students BETWEEN 1 AND 6);

-- "Class requests": the demand side of the marketplace. A student posts what
-- they want to learn ("pronouns in Spanish"), how many people it should be
-- for, and when — and teachers browse those and turn one into a real class.
--
-- Deliberately NOT a class: no credits are spent, nobody is enrolled, and it
-- disappears on its own after 24 hours (see expires_at). It's a wanted-ad.
CREATE TABLE IF NOT EXISTS class_requests (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id),
  language_code TEXT NOT NULL,
  level TEXT,
  topic TEXT NOT NULL CHECK (char_length(topic) <= 80),
  details TEXT CHECK (details IS NULL OR char_length(details) <= 400),
  max_students SMALLINT NOT NULL CHECK (max_students BETWEEN 1 AND 20),
  preferred_time TIMESTAMPTZ NOT NULL,
  -- The negotiation switch: when true the teacher is free to schedule at a
  -- different time and preferred_time is only a starting point.
  time_flexible BOOLEAN NOT NULL DEFAULT false,
  -- Stored rather than derived from created_at so that changing the TTL
  -- constant later can't retroactively kill (or resurrect) live requests.
  expires_at TIMESTAMPTZ NOT NULL,
  -- Set when a teacher answers the request by creating a class from it.
  fulfilled_class_id INTEGER REFERENCES classes(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The browse query: still open, not yet expired.
CREATE INDEX IF NOT EXISTS class_requests_open_idx ON class_requests(expires_at DESC)
  WHERE fulfilled_class_id IS NULL;

-- "+1, I want this too". One person asking is noise; six is a signal a
-- teacher will act on, and it also tells them how full the class would be.
CREATE TABLE IF NOT EXISTS class_request_interest (
  request_id INTEGER NOT NULL REFERENCES class_requests(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, user_id)
);

-- notifications.type is a closed CHECK list, so the new notification has to
-- be added to it or every insert silently fails (same trap as
-- credit_transactions_type_check).
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('student_joined', 'class_starting_soon', 'class_started', 'request_fulfilled'));

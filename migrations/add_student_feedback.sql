-- Teacher -> student feedback, the mirror of class_reviews (student -> teacher).
-- One row per (session, student): seven 1-5 skill scores plus a short note.
-- Every skill is nullable so a teacher can rate only what they observed.
CREATE TABLE IF NOT EXISTS student_feedback (
  id SERIAL PRIMARY KEY,
  class_session_id INTEGER NOT NULL REFERENCES class_sessions(id),
  student_id INTEGER NOT NULL REFERENCES users(id),
  teacher_id INTEGER NOT NULL REFERENCES users(id),
  vocabulary SMALLINT CHECK (vocabulary BETWEEN 1 AND 5),
  pronunciation SMALLINT CHECK (pronunciation BETWEEN 1 AND 5),
  phrase_formation SMALLINT CHECK (phrase_formation BETWEEN 1 AND 5),
  fluency SMALLINT CHECK (fluency BETWEEN 1 AND 5),
  grammar SMALLINT CHECK (grammar BETWEEN 1 AND 5),
  listening SMALLINT CHECK (listening BETWEEN 1 AND 5),
  confidence SMALLINT CHECK (confidence BETWEEN 1 AND 5),
  comment TEXT CHECK (comment IS NULL OR char_length(comment) <= 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Re-submitting overwrites rather than piling up duplicates; the route
  -- upserts onto this constraint instead of doing a read-then-insert race.
  UNIQUE (class_session_id, student_id)
);

CREATE INDEX IF NOT EXISTS student_feedback_student_idx ON student_feedback(student_id, created_at DESC);

-- The member survey (utils/survey.js, routes/survey.js): five short
-- questions, one answer set per member, 1 bonus banana on completion.
-- Answers save as the member goes; completed_at marks the end, and
-- banana_granted_at makes the banana once-only (it waits for the welcome
-- grant when the phone isn't verified yet: routes/auth.js /add-phone).
CREATE TABLE IF NOT EXISTS survey_responses (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  heard_from TEXT,
  heard_detail TEXT,
  who TEXT,
  who_detail TEXT,
  goals TEXT[] NOT NULL DEFAULT '{}',
  times TEXT[] NOT NULL DEFAULT '{}',
  ideas TEXT,
  completed_at TIMESTAMPTZ,
  banana_granted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;

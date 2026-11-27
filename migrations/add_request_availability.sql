-- Free hours for class requests (owner, 2026-11-27; utils/availability.js):
-- the student who asks and everyone who +1s mark the hours they are free in
-- the next 7 days, one row per person per request, each slot the UTC start
-- of an hour. Teachers of that language see the counts (and first names) to
-- pick the hour. Read and written only by the backend's service key, so RLS
-- is on with no policies: nothing reaches it from the browser directly.
CREATE TABLE IF NOT EXISTS request_availability (
  request_id INTEGER NOT NULL REFERENCES class_requests(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slots TIMESTAMPTZ[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, user_id)
);
ALTER TABLE request_availability ENABLE ROW LEVEL SECURITY;

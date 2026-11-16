-- When each member last got the "people want to learn your language" email,
-- so it goes out at most once every 14 days (utils/teachNudge.js,
-- scripts/teachNudge.js). Null = never sent.
ALTER TABLE users ADD COLUMN IF NOT EXISTS teach_nudge_sent_at TIMESTAMPTZ;

-- Tandem round 2 (owner request, 2026-11-19).
--
-- 1. 1-to-1 tandem chats become temporary, like class chats: open 2 days
--    after a hello is accepted (or "Meet again") to agree a time, then until
--    1 day after the agreed call ends. routes/tandems.js sets both columns.
ALTER TABLE tandems ADD COLUMN IF NOT EXISTS agreed_time TIMESTAMPTZ;
ALTER TABLE tandems ADD COLUMN IF NOT EXISTS chat_open_until TIMESTAMPTZ;
-- Tandems accepted before this change get the same 2 days from now.
UPDATE tandems SET chat_open_until = now() + interval '2 days'
  WHERE status = 'accepted' AND chat_open_until IS NULL;

-- 2. Tandem groups (routes/tandemGroups.js): a free conversation swap
--    between two languages, half the seats for each side.
CREATE TABLE IF NOT EXISTS tandem_groups (
  id SERIAL PRIMARY KEY,
  host_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lang_a TEXT NOT NULL,
  lang_b TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes IN (45, 60, 90)),
  size INTEGER NOT NULL CHECK (size IN (4, 6, 8)),
  topic TEXT CHECK (topic IS NULL OR char_length(topic) <= 120),
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (lang_a <> lang_b)
);
CREATE INDEX IF NOT EXISTS tandem_groups_starts_idx ON tandem_groups (starts_at);
ALTER TABLE tandem_groups ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS tandem_group_members (
  group_id INTEGER NOT NULL REFERENCES tandem_groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The language this member speaks in the swap: lang_a or lang_b.
  side TEXT NOT NULL CHECK (side IN ('a', 'b')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS tandem_group_members_user_idx ON tandem_group_members (user_id);
ALTER TABLE tandem_group_members ENABLE ROW LEVEL SECURITY;

-- 3. Group chats reuse chat_messages.
ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_thread_type_check;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_thread_type_check
  CHECK (thread_type IN ('session', 'request', 'tandem', 'tandem_group'));

-- 4. New bell types: someone you match is looking for a tandem, a time was
--    agreed / "Meet again", and tandem group news. The full list, so
--    re-running this never drops a type added before it.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('student_joined', 'class_starting_soon', 'class_started',
                  'request_fulfilled', 'credit_added', 'assignment_answered',
                  'account_approved', 'class_ended', 'chat_message',
                  'request_offer', 'request_chat', 'no_show', 'report_update',
                  'tandem_request', 'tandem_accepted', 'tandem_message',
                  'tandem_looking', 'tandem_time', 'tandem_group'));

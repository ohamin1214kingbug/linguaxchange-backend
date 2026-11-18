-- Tandem partners (routes/tandems.js): two members who teach each other's
-- languages practise one-to-one for free, no bananas. Members are only
-- listed after opting in (users.tandem_open). One live tandem per pair:
-- a new hello is refused while one is pending or accepted.
ALTER TABLE users ADD COLUMN IF NOT EXISTS tandem_open BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS tandems (
  id SERIAL PRIMARY KEY,
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  partner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'ended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  CHECK (requester_id <> partner_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS tandems_live_pair_idx
  ON tandems (LEAST(requester_id, partner_id), GREATEST(requester_id, partner_id))
  WHERE status IN ('pending', 'accepted');
CREATE INDEX IF NOT EXISTS tandems_partner_idx ON tandems (partner_id);
CREATE INDEX IF NOT EXISTS tandems_requester_idx ON tandems (requester_id);
ALTER TABLE tandems ENABLE ROW LEVEL SECURITY;

-- The tandem's private chat reuses chat_messages.
ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_thread_type_check;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_thread_type_check
  CHECK (thread_type IN ('session', 'request', 'tandem'));

-- Bell notifications for a hello, an accepted hello and new chat messages.
-- The full list, so re-running this never drops a type added before it.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('student_joined', 'class_starting_soon', 'class_started',
                  'request_fulfilled', 'credit_added', 'assignment_answered',
                  'account_approved', 'class_ended', 'chat_message',
                  'request_offer', 'request_chat', 'no_show', 'report_update',
                  'tandem_request', 'tandem_accepted', 'tandem_message'));

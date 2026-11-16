-- Request chat (owner request, 2026-11-16): a teacher offers to teach a
-- class request, which opens a chat with the student who asked and the +1s
-- to agree a time. While teachers are talking, the 24-hour refund clock is
-- held: each teacher message keeps the request open 24 more hours, never
-- beyond 72 hours after it was posted (utils/requestChat.js).

CREATE TABLE IF NOT EXISTS request_offers (
  request_id INTEGER NOT NULL REFERENCES class_requests(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, teacher_id)
);
ALTER TABLE request_offers ENABLE ROW LEVEL SECURITY;

-- A teacher's message can carry a proposed time the student can accept.
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS proposed_time TIMESTAMPTZ;

-- The time the student accepted, and whose proposal it was.
ALTER TABLE class_requests ADD COLUMN IF NOT EXISTS agreed_time TIMESTAMPTZ;
ALTER TABLE class_requests ADD COLUMN IF NOT EXISTS agreed_teacher_id INTEGER REFERENCES users(id);

-- Request notifications point at the request, not a class session.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS request_id INTEGER REFERENCES class_requests(id) ON DELETE CASCADE;

-- notifications.type is a closed CHECK list; every type so far, plus two.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('student_joined', 'class_starting_soon', 'class_started',
                  'request_fulfilled', 'credit_added', 'assignment_answered',
                  'account_approved', 'class_ended', 'chat_message',
                  'request_offer', 'request_chat'));

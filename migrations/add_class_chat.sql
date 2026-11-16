-- Class chat (owner request, 2026-11-16): the teacher and booked students
-- of a class session can talk from booking until 24 hours after the class.
-- thread_type leaves room for the request chat ('request') that comes next.
CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGSERIAL PRIMARY KEY,
  thread_type TEXT NOT NULL CHECK (thread_type IN ('session', 'request')),
  thread_id BIGINT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Deleted by its author or the class's teacher; kept for moderation.
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS chat_messages_thread_idx ON chat_messages (thread_type, thread_id, id);

-- Same as every other table: the backend reads with the service key, and
-- nothing is reachable with the public anon key.
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- notifications.type is a closed CHECK list. This repeats every type so far,
-- including 'class_ended' in case add_class_ended_notification.sql has not
-- been run yet.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('student_joined', 'class_starting_soon', 'class_started',
                  'request_fulfilled', 'credit_added', 'assignment_answered',
                  'account_approved', 'class_ended', 'chat_message'));

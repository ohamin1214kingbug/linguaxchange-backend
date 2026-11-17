-- A member is told when an admin changes the status of a report they sent
-- (routes/reports.js PATCH /:id; the bell links to the My reports page).
-- The full list, so re-running this never drops a type added before it.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('student_joined', 'class_starting_soon', 'class_started',
                  'request_fulfilled', 'credit_added', 'assignment_answered',
                  'account_approved', 'class_ended', 'chat_message',
                  'request_offer', 'request_chat', 'no_show', 'report_update'));

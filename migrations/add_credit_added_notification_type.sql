-- notifications.type is a closed CHECK list (see add_class_requests.sql) —
-- an admin credit grant needs its own entry or the insert silently fails.
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('student_joined', 'class_starting_soon', 'class_started', 'request_fulfilled', 'credit_added'));

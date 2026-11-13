-- After a class ends, each student who has not confirmed attendance gets an
-- in-app (and push) notification asking them to confirm and review it
-- (utils/inAppNotifications.js, sendEndedNotifications). Owner request,
-- 2026-11-13: confirming and reviewing were easy to miss.

-- Same atomic-claim pattern as starting_soon_notified_at / live_notified_at:
-- a session is claimed before anyone is notified, so overlapping cron runs
-- cannot notify twice.
ALTER TABLE class_sessions ADD COLUMN IF NOT EXISTS ended_notified_at TIMESTAMPTZ;

-- notifications.type is a closed CHECK list.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('student_joined', 'class_starting_soon', 'class_started',
                  'request_fulfilled', 'credit_added', 'assignment_answered',
                  'account_approved', 'class_ended'));

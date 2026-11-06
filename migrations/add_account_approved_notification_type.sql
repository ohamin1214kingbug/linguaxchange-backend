-- notifications.type is a closed CHECK list (see add_assignment_feedback.sql):
-- the in-app "your account is approved" notice needs its own entry, or the
-- insert in POST /api/admin/users/:id/approve fails (logged, email still sent).
alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('student_joined', 'class_starting_soon', 'class_started',
                  'request_fulfilled', 'credit_added', 'assignment_answered',
                  'account_approved'));

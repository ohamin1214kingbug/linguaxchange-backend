-- Invite bell (owner plan 6, 2026-11-19): the member whose invite link was
-- used is told at once (utils/referrals.js notifyInviteJoined). The full
-- list, so re-running this never drops a type added before it.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('student_joined', 'class_starting_soon', 'class_started',
                  'request_fulfilled', 'credit_added', 'assignment_answered',
                  'account_approved', 'class_ended', 'chat_message',
                  'request_offer', 'request_chat', 'no_show', 'report_update',
                  'tandem_request', 'tandem_accepted', 'tandem_message',
                  'tandem_looking', 'tandem_time', 'tandem_group',
                  'invite_joined'));

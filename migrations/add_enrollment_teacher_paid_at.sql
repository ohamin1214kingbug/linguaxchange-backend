-- One payout lock per enrollment, shared by the student's "confirm
-- attendance" and the automatic payout 72 hours after the class
-- (utils/attendancePayout.js). Run BEFORE deploying that code: the confirm
-- route writes this column.
ALTER TABLE class_enrollments
  ADD COLUMN IF NOT EXISTS teacher_paid_at timestamptz;

-- Every enrollment already confirmed was already paid (or its failed payout
-- was logged as [CREDIT_LEDGER] at the time). Mark them so neither path pays
-- them again.
UPDATE class_enrollments
  SET teacher_paid_at = now()
  WHERE status = 'attended' AND teacher_paid_at IS NULL;

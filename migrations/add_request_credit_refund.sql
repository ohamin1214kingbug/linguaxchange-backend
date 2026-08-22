-- Posting a class request now costs a credit, and that credit is the payment
-- for the class the request turns into — the requester is auto-enrolled on
-- fulfilment without being charged a second time.
--
-- A request that nobody answers has to give the credit back, or students pay
-- for classes that never happened and stop posting requests. Withdrawing
-- deletes the row, so that refund can only ever fire once; an expired
-- request keeps its row, so the sweep needs somewhere to record that it
-- already paid out. Claiming this column with a conditional UPDATE
-- (.is('credit_refunded_at', null)) is what stops a double refund when two
-- cron ticks overlap.
ALTER TABLE class_requests
  ADD COLUMN IF NOT EXISTS credit_refunded_at TIMESTAMPTZ;

-- The sweep looks for expired, unfulfilled, not-yet-refunded rows.
CREATE INDEX IF NOT EXISTS class_requests_refund_sweep_idx
  ON class_requests (expires_at)
  WHERE fulfilled_class_id IS NULL AND credit_refunded_at IS NULL;

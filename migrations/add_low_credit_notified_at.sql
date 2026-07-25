ALTER TABLE credits
  ADD COLUMN IF NOT EXISTS low_credit_notified_at TIMESTAMPTZ;

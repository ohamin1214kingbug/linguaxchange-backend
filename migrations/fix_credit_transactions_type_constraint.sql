-- credit_transactions_type_check only allowed ('spent', 'earned'), so every
-- 'refunded' insert (class cancellation refunds, and the new 24h enrollment
-- cancellation refund) has been silently failing since the app code never
-- checks that insert's error. The credit balance itself is unaffected
-- (separate unconstrained update) - only the audit-log row was missing.
ALTER TABLE credit_transactions DROP CONSTRAINT credit_transactions_type_check;
ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_type_check
  CHECK (type IN ('spent', 'earned', 'refunded'));

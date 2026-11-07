-- Invite a friend: who invited whom, and whether the reward for it has been
-- paid. The reward is claimed by setting referral_rewarded_at where it is
-- still null, so it can only ever be paid once per invited member.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS referred_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referral_rewarded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS users_referred_by_idx ON users (referred_by);

-- The invite banana gets its own type. Logging it as 'earned' would count
-- as having taught (creditSpendGate.hasEverTaught) and unlock the last
-- banana for someone who never taught.
ALTER TABLE credit_transactions DROP CONSTRAINT credit_transactions_type_check;
ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_type_check
  CHECK (type IN ('spent', 'earned', 'refunded', 'bonus'));

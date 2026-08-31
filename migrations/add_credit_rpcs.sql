-- Credit balance changes were done in app code as read-then-write:
--   select balance; ... ; update balance = <computed>
-- which loses updates and double-spends under concurrency (two joins at the
-- same instant both read balance=1 and both write 0). These two functions
-- move the arithmetic into a single atomic statement so the database, not
-- the request timing, decides the outcome — the same "let the DB serialise
-- it" approach enforce_class_capacity.sql already uses for seats.
--
-- SECURITY DEFINER + pinned search_path for the same reason as the capacity
-- trigger: the backend's service-role key bypasses RLS today, but if any
-- path ever ran under a restricted role an INVOKER function could see a
-- filtered `credits` and silently misbehave.

-- Atomic spend. Decrements only when the balance can cover it; returns the
-- new balance, or NULL (no row updated) when funds are insufficient — the
-- caller treats NULL as "not enough credits".
CREATE OR REPLACE FUNCTION spend_credit(p_user_id INTEGER, p_amount INTEGER)
RETURNS INTEGER
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE sql
AS $$
  UPDATE credits
  SET balance = balance - p_amount
  WHERE user_id = p_user_id AND balance >= p_amount
  RETURNING balance;
$$;

-- Atomic add (grant/refund). Returns the new balance, or NULL when the user
-- has no credits row — the caller treats NULL as "no credits row to top up"
-- and skips writing an orphan transaction.
CREATE OR REPLACE FUNCTION add_credit(p_user_id INTEGER, p_amount INTEGER)
RETURNS INTEGER
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE sql
AS $$
  UPDATE credits
  SET balance = balance + p_amount
  WHERE user_id = p_user_id
  RETURNING balance;
$$;

-- The Security Advisor flags enforce_class_capacity() as a SECURITY DEFINER
-- function that anon and authenticated can execute. In practice nobody can:
-- it RETURNS TRIGGER, PostgREST leaves trigger functions out of its schema
-- cache (POST /rest/v1/rpc/enforce_class_capacity answers 404 PGRST202), and
-- Postgres refuses to call a trigger function outside a trigger anyway.
--
-- Revoked so the advisor stays quiet and a real finding stands out. The
-- trigger keeps firing: Postgres checks EXECUTE on a trigger function when
-- CREATE TRIGGER runs, not each time the trigger fires. The explicit
-- service_role grant covers the backend's inserts regardless.
REVOKE EXECUTE ON FUNCTION public.enforce_class_capacity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_class_capacity() TO service_role;

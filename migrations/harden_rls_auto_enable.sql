-- rls_auto_enable() is a real, active guardrail: an event trigger
-- (ensure_rls, owned by postgres) that fires on every CREATE TABLE in the
-- public schema and auto-enables RLS on it. Not the vulnerability itself —
-- it's the fix for the exact class of bug this session already found twice
-- (new tables shipping without RLS).
--
-- What the advisor flagged is just Postgres's default: EXECUTE on a new
-- function is granted to PUBLIC unless revoked. Event triggers fire via the
-- trigger machinery, not a caller's own EXECUTE grant, so revoking this
-- doesn't affect ensure_rls itself — it only stops someone from calling
-- rls_auto_enable() directly (which would error anyway outside of a DDL
-- event trigger context, since it reads pg_event_trigger_ddl_commands()).
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
-- Supabase also grants EXECUTE directly to anon/authenticated on new
-- functions, independent of the PUBLIC grant above — revoking from PUBLIC
-- alone left both of those in place, so the advisor still flagged it.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated;

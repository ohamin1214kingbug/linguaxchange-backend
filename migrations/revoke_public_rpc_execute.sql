-- spend_credit and add_credit are SECURITY DEFINER, so they run as their
-- owner and bypass RLS on `credits`. Postgres grants EXECUTE on new functions
-- to PUBLIC, and Supabase also grants it to anon/authenticated, so anyone
-- holding the publishable key (it ships in the frontend bundle) could call
-- POST /rest/v1/rpc/add_credit with any user id and amount: mint credits for
-- themselves, or drain someone else's with spend_credit. Verified from outside
-- on 2026-09-21 with a no-op call (user -999999, amount 0): both returned 200.
--
-- Only the backend calls these, with the service-role key, so it is the only
-- role that keeps EXECUTE. The explicit GRANT makes that independent of
-- whatever default privileges the project happens to have.
--
-- search_users_fuzzy is SECURITY INVOKER, so RLS already hides every row from
-- anon (the same probe returned an empty list). Revoked anyway: the backend
-- is its only caller, and it should not start returning names the day a
-- permissive policy lands on `users`.
--
-- Same PUBLIC + anon/authenticated pair as harden_rls_auto_enable.sql:
-- revoking from PUBLIC alone leaves Supabase's direct grants in place.
REVOKE EXECUTE ON FUNCTION public.spend_credit(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.add_credit(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.search_users_fuzzy(text, int, real) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.spend_credit(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_credit(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.search_users_fuzzy(text, int, real) TO service_role;

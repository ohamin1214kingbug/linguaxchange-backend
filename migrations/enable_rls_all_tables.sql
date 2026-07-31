-- The backend (Express) always uses the Supabase service-role key, which
-- bypasses RLS entirely — so enabling RLS here has zero effect on the
-- backend's own behavior. The frontend's public/anon key is only ever used
-- for supabase.auth.* and supabase.storage.* calls (checked: no
-- supabase.from(...) calls anywhere in the frontend), so it has no
-- legitimate reason to read or write these tables directly. Enabling RLS
-- with no policies makes that the enforced default instead of an
-- accidental one — right now any of these tables can be read or written by
-- anyone who extracts the public anon key from the frontend's JS bundle
-- (which is always possible, since that key is not a secret) and calls
-- Supabase's REST API directly, completely bypassing this app's auth,
-- authorization, and rate limiting.
ALTER TABLE class_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE language_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_learning_languages ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_native_languages ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

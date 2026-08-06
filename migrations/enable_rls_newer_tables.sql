-- Follow-up to enable_rls_all_tables.sql, for tables added after that
-- migration: notifications, student_feedback, class_requests, and
-- class_request_interest. Same reasoning applies — the backend always uses
-- the service-role key (bypasses RLS) and the frontend never calls
-- supabase.from(...) directly, so this closes the anon-key hole without
-- needing any policies.
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_request_interest ENABLE ROW LEVEL SECURITY;

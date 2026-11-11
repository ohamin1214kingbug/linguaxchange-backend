-- Teachers can upload their language certificate, and learners can say how
-- well they know each language they are learning. Run once in the Supabase
-- SQL editor; safe to run twice.

-- The certificate file. Where it is in storage, the name it was uploaded
-- with, and when. Students only ever learn that a file exists
-- (certificate_uploaded_at); the file is for admins.
ALTER TABLE users ADD COLUMN IF NOT EXISTS certificate_path TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS certificate_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS certificate_uploaded_at TIMESTAMPTZ;

-- Level and a short description per language being learned, keyed by
-- language code: {"ES": {"level": "B1", "note": "I freeze when I speak"}}.
-- learn_languages stays the list of languages; this only adds detail to it,
-- so profiles saved before this keep working with no detail.
ALTER TABLE users ADD COLUMN IF NOT EXISTS learn_details JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Private, like report-evidence: certificates can show a date of birth or an
-- ID number. The backend reads them with the service key and hands admins a
-- short-lived signed link; nothing is ever public.
INSERT INTO storage.buckets (id, name, public)
VALUES ('certificates', 'certificates', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- When the member proved they own their email (utils/emailCode.js).
-- Email sign-ups confirm a 6-digit code first; Google sign-ins are proven by
-- Google. Admin rights require it (middleware/auth.js requireAdmin), and a
-- Google sign-in into an unconfirmed password account turns that password
-- off (routes/auth.js /google-login).
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

-- Every account that has signed in with Google already proved its email.
UPDATE users SET email_verified_at = created_at
WHERE google_id IS NOT NULL AND email_verified_at IS NULL;

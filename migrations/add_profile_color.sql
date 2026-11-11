-- Members choose the colour of their profile card (owner request,
-- 2026-11-12). Shown on their own profile and their public teacher page.
-- NULL means the default (yellow). The CHECK mirrors PROFILE_COLORS in
-- utils/profileFields.js; add a colour in both places.
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_color TEXT;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_profile_color_check;
ALTER TABLE users ADD CONSTRAINT users_profile_color_check
  CHECK (profile_color IS NULL OR profile_color IN ('yellow', 'blue', 'coral', 'green', 'purple', 'teal', 'white'));

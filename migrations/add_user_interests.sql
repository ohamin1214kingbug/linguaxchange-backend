-- Interest tags (owner, 2026-11-28; utils/interests.js): up to 5 keys from
-- a fixed list, picked at sign-up or in settings, shown on profiles and
-- used to sort tandem partners. Empty for everyone until they pick.
ALTER TABLE users ADD COLUMN IF NOT EXISTS interests TEXT[] NOT NULL DEFAULT '{}';

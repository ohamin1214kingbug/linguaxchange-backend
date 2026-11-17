-- Admin activity log (utils/adminLog.js, admin page "Activity" tab): every
-- admin action that changes something or opens a private file. Only ever
-- inserted and read by the backend; no route updates or deletes rows.
CREATE TABLE IF NOT EXISTS admin_actions (
  id BIGSERIAL PRIMARY KEY,
  admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id BIGINT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_actions_created_idx ON admin_actions (created_at DESC);
ALTER TABLE admin_actions ENABLE ROW LEVEL SECURITY;

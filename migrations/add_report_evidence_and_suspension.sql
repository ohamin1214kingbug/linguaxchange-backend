-- Reporting and moderation, in one migration because the admin queue is
-- unusable if half of it lands.

-- Categories exist so the queue can be ordered by severity instead of only
-- by date. `no_show` is listed separately on purpose: it is the most common
-- complaint on a booking site and it is not a safety issue, so keeping it
-- out of 'other' stops eight no-shows from burying one harassment report.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS category TEXT;

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_category_check;
ALTER TABLE reports ADD CONSTRAINT reports_category_check
  CHECK (category IS NULL OR category IN
    ('harassment', 'inappropriate_content', 'spam_or_scam', 'no_show', 'other'));

-- Nullable rather than NOT NULL: the one report already in this table
-- predates categories, and backfilling it with a guess would be inventing
-- evidence about a real complaint.

-- Storage paths, not URLs. Every read mints a fresh signed URL, so a stored
-- URL would be a dead link within the hour.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS evidence_paths TEXT[] NOT NULL DEFAULT '{}';

-- Suspension. One nullable timestamp rather than a boolean plus a date:
-- two columns can disagree about whether someone is banned. A permanent ban
-- is a far-future date.
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspension_reason TEXT;

-- Private bucket. Every other bucket here is public, which is right for an
-- avatar and wrong for a screenshot of someone being harassed: a public URL
-- is permanent, unauthenticated, and shareable by anyone who ever sees it.
-- Reads go through 60-minute signed URLs instead.
INSERT INTO storage.buckets (id, name, public)
VALUES ('report-evidence', 'report-evidence', false)
ON CONFLICT (id) DO UPDATE SET public = false;

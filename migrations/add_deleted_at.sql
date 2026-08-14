-- Marks an anonymized account. The row itself has to stay: classes,
-- class_enrollments, class_reviews and credit_transactions all reference
-- users(id) ON DELETE CASCADE, so a hard DELETE would take other students'
-- booking history and the financial record with it.
--
-- Nullable timestamp rather than a boolean — "when" is worth keeping for
-- support questions, and NULL/NOT NULL reads the same as a flag.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

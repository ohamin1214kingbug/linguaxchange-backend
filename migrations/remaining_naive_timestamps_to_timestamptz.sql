-- The last `timestamp without time zone` columns -> timestamptz.
--
-- Companion to session_date_to_timestamptz.sql, which converted the one
-- column the backend does date arithmetic on. These twelve are display and
-- sort fields, so nothing was broken outright — but PostgREST returns them
-- with no offset, and a date-time string without one is parsed as LOCAL
-- time per the JS spec. Five places in the frontend call
-- `new Date(created_at).toLocaleDateString()` directly, so any row within
-- two hours of midnight UTC renders on the wrong day for a viewer in
-- Madrid. After this they carry their offset and render correctly, and
-- `asUtcDate` passes them through untouched.
--
-- Verified UTC before writing this, rather than assumed. A single join
-- request writes class_enrollments.created_at (naive), then
-- credit_transactions.created_at (naive), then notifications.created_at
-- (already timestamptz). In production those landed at 05:17:57.095,
-- 05:17:57.456 and 05:17:58.744+00:00 — 1.6 seconds apart. Stored in any
-- other zone they would differ by hours, so `at time zone 'UTC'` reads them
-- back as the instants they were written as and no value changes meaning.
--
-- The list is explicit rather than "every naive column in public": a column
-- someone deliberately makes naive later should not be swept up by a
-- migration re-run. The WHERE clause makes it idempotent — a column already
-- converted is simply not selected.
--
-- Defaults of now() re-cast automatically; now() is natively timestamptz.
do $$
declare
  r record;
begin
  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.data_type    = 'timestamp without time zone'
      and (c.table_name, c.column_name) in (
        ('class_enrollments',   'created_at'),
        ('class_enrollments',   'updated_at'),
        ('class_reviews',       'created_at'),
        ('classes',             'created_at'),
        ('classes',             'updated_at'),
        ('credit_transactions', 'created_at'),
        ('credits',             'updated_at'),
        ('reports',             'created_at'),
        ('reports',             'updated_at'),
        ('users',               'created_at'),
        ('users',               'updated_at'),
        ('users',               'last_login')
      )
  loop
    raise notice 'converting %.% to timestamptz', r.table_name, r.column_name;
    execute format(
      'alter table public.%I alter column %I type timestamptz using %I at time zone ''UTC''',
      r.table_name, r.column_name, r.column_name
    );
  end loop;
end $$;

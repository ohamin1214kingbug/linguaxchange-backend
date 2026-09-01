-- class_sessions.session_date: timestamp without time zone -> timestamptz
--
-- Every value in this column was written by the backend as
-- `date.toISOString()`, i.e. a UTC instant. Postgres then discarded the
-- offset, because the column could not hold one, and PostgREST returned the
-- bare wall clock ("2026-09-09T17:00:00"). Per the JS spec a date-time
-- string with no offset is parsed as LOCAL time, so every `new Date(...)` on
-- this value — the attendance window, the cancellation refund cutoff, every
-- "is this class still upcoming" check — was shifted by the host's UTC
-- offset. Production was correct only because Railway runs UTC; the same
-- code on a machine in Madrid read every session two hours early.
--
-- Both codebases carry a workaround for this: process.env.TZ = 'UTC' in
-- index.js, and asUtcDate() in the frontend's lib/timezone.js. This removes
-- the reason for both.
--
-- `at time zone 'UTC'` reads each stored wall clock AS a UTC instant, which
-- is exactly how it was written, so no value changes meaning. The column
-- simply starts carrying the offset it always implied.
--
-- Safe to re-run: the guard skips the ALTER once the type is already right.
-- The table is small and the rewrite is effectively instantaneous; the
-- (session_date, reminder_sent_at, status) index is rebuilt automatically.
--
-- Not included, deliberately: classes.created_at/updated_at,
-- users.created_at/updated_at and credit_transactions.created_at are also
-- `timestamp without time zone`. Nothing does date arithmetic on them, only
-- display and sorting, so they are a separate decision. The same guarded
-- ALTER works for each if you want them converted.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'class_sessions'
      and column_name  = 'session_date'
      and data_type    = 'timestamp without time zone'
  ) then
    alter table class_sessions
      alter column session_date type timestamptz
      using session_date at time zone 'UTC';
  end if;
end $$;

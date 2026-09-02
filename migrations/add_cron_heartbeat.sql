-- One row per scheduled job, recording when it last completed.
--
-- Written after "Send Class Reminders" was found dead on 2026-09-02, having
-- last run on 2026-07-31. Its URL carried a CRON_SECRET that no longer
-- matched the environment, so every call 401'd, cron-job.org disabled the job
-- after repeated failures, and nothing anywhere reported it. Five weeks of no
-- class reminders and no starting-soon notifications.
--
-- Nothing in the database could have revealed it either: reminder_sent_at is
-- only written when a reminder actually goes out, so a job that never runs
-- and a job with nothing to do look identical. This table separates them —
-- the heartbeat is written on every run, including runs that send nothing.
--
-- ponytail: one timestamp per job, no run history. A history table would
-- answer questions nobody has asked; "when did this last work" is the only
-- one that mattered.
create table if not exists cron_heartbeat (
  job         text primary key,
  last_run_at timestamptz not null default now()
);

-- Matches every other table here: the backend holds the service-role key and
-- the frontend never queries Supabase directly, so RLS on with no policies
-- closes the anon-key hole outright.
alter table cron_heartbeat enable row level security;

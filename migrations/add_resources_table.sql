-- One admin-managed study resource per (language, level, audience).
--
-- audience ships in v1 even though only 'learner' is used, so the
-- teacher-facing guides ("what to teach", "how to teach") need a data entry
-- rather than a migration later.
--
-- Written to be idempotent: an earlier version of this table was created by
-- hand before the design changed, so this has to be correct both against the
-- production database as it stands and against a fresh environment.
create table if not exists resources (
  id serial primary key,
  language_code text not null,           -- KO/ES/DE/EN/PT/FR/IT
  level text not null,                   -- A1..C2
  audience text not null default 'learner',
  title text not null,
  description text,
  pdf_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (language_code, level, audience)
);

-- Added when the design changed from hosting third-party PDFs to writing our
-- own guides: source_url is the official syllabus a guide aligns with,
-- attribution is reserved for third-party material under a confirmed open
-- licence.
--
-- Separate statements rather than columns in the create above, because the
-- table already exists in production and create-if-not-exists would skip them
-- silently.
alter table resources add column if not exists source_url text;
alter table resources add column if not exists attribution text;

-- create table if not exists skips the ENTIRE definition when the table is
-- already there, including the audience column and the unique constraint. Both
-- are load-bearing: every route selects audience, and POST /api/resources
-- upserts on (language_code, level, audience), which fails outright with
-- "no unique or exclusion constraint matching the ON CONFLICT specification"
-- if that constraint is missing.
--
-- Production has both today. These guards exist so a second environment built
-- from this file cannot end up subtly different — which is the whole reason
-- the file is written to be re-runnable.
alter table resources add column if not exists audience text not null default 'learner';

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'resources' and c.contype = 'u'
  ) then
    alter table resources
      add constraint resources_language_code_level_audience_key
      unique (language_code, level, audience);
  end if;
end $$;

-- Matches every other table in this project: the backend holds the
-- service-role key and the frontend never queries Supabase directly, so
-- enabling RLS with no policies closes the anon-key hole outright.
alter table resources enable row level security;

-- The bucket lives here rather than being clicked together in the dashboard,
-- so the storage config is recorded next to the table it serves and a second
-- environment can be brought up from one file.
--
-- public = true is the point of the feature: a logged-out visitor and a
-- crawler both have to fetch the PDF without a token. Writes are safe anyway,
-- because uploads come from the backend on the service-role key.
--
-- No storage policy is added, and none should be. This matches the existing
-- class-materials bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resources', 'resources', true, 10485760, array['application/pdf'])
on conflict (id) do nothing;

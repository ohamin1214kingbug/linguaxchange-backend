-- Assignment feedback: a student posts a short passage, a native speaker
-- annotates spans of it. Never corrected text — that constraint shapes the
-- schema, which is why there is no column for a rewritten version.
--
-- Applied by hand in the Supabase SQL editor on 2026-09-03. This file exists
-- so a second environment can be rebuilt from the repository, matching every
-- other migration here.

create table if not exists assignment_requests (
  id                 serial primary key,
  student_id         integer not null references users(id),
  language_code      text not null,
  level              text,
  prompt             text not null,
  -- Immutable after insert. Annotation offsets index into this string, so an
  -- edit would move every annotation onto the wrong words with no error.
  body               text not null,
  expires_at         timestamptz not null,
  credit_refunded_at timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists assignment_requests_open_idx
  on assignment_requests (language_code, expires_at);

create table if not exists assignment_feedback (
  id                 serial primary key,
  -- Unique: this is how "first response wins" is enforced. The database
  -- rejects the second submission rather than the application checking and
  -- racing, the same reliance on a constraint that enforce_class_capacity.sql
  -- uses for seats.
  request_id         integer not null unique references assignment_requests(id),
  reviewer_id        integer not null references users(id),
  annotations        jsonb not null default '[]'::jsonb,
  overall            text,
  created_at         timestamptz not null default now(),
  acknowledged_at    timestamptz,
  credit_released_at timestamptz
);

create index if not exists assignment_feedback_unreleased_idx
  on assignment_feedback (credit_released_at, created_at);

alter table assignment_requests enable row level security;
alter table assignment_feedback enable row level security;

-- credit_transactions.type was character varying(10). 'earned_feedback' is
-- fifteen characters, so every insert failed with 22001 while the CHECK
-- constraint below looked correct — and because the calling code did not check
-- that insert's error, add_credit would have paid out every time while the row
-- used to enforce the weekly cap never appeared. An uncapped currency, in
-- silence.
--
-- This repository has already been bitten once by an unchecked insert on this
-- exact table (see fix_credit_transactions_type_constraint.sql). Widening to
-- text removes the width trap for every future type name rather than shortening
-- this one value to fit.
alter table credit_transactions alter column type type text;

alter table credit_transactions drop constraint credit_transactions_type_check;
alter table credit_transactions add constraint credit_transactions_type_check
  check (type in ('spent', 'earned', 'refunded', 'earned_feedback'));

alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('student_joined', 'class_starting_soon', 'class_started',
                  'request_fulfilled', 'credit_added', 'assignment_answered'));

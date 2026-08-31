-- Allowlist of university email domains. A badge means exactly as much as the
-- care taken adding rows here, which is why this is a curated table rather
-- than a pattern match on the address.
create table if not exists university_domains (
  domain text primary key,        -- 'ucm.es', lowercase, no leading @
  name text not null,             -- 'Universidad Complutense de Madrid'
  created_at timestamptz not null default now()
);

-- RLS on with no policies, matching every other table here: the backend holds
-- the service-role key and the frontend never queries Supabase directly.
alter table university_domains enable row level security;

-- university_email is stored only to enforce uniqueness — one address cannot
-- verify two accounts — and is never exposed by any public route.
-- university_domain is stored rather than derived so the badge needs no join
-- on every profile render.
-- The address is only claimed once ownership is proven. Writing
-- university_email at send time instead would let anyone type a stranger's
-- address into their own row and, via the unique index below, permanently
-- block the real owner from ever verifying it. Pending is deliberately NOT
-- unique: several people may have the same address pending, and exactly one
-- of them can hold the token that confirms it.
alter table users add column if not exists university_pending_email text;
alter table users add column if not exists university_email text;
alter table users add column if not exists university_domain text;
alter table users add column if not exists university_verified_at timestamptz;
alter table users add column if not exists university_token text;
alter table users add column if not exists university_token_expires timestamptz;
alter table users add column if not exists record_token text;

-- Partial: NULL is the normal state for both columns — every existing user has
-- NULL — and a plain unique constraint would index all of them for nothing.
create unique index if not exists users_university_email_key
  on users (university_email) where university_email is not null;

create unique index if not exists users_record_token_key
  on users (record_token) where record_token is not null;

insert into university_domains (domain, name)
values ('ucm.es', 'Universidad Complutense de Madrid')
on conflict (domain) do nothing;

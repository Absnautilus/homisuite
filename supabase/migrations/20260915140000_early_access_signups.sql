-- Early Access signups submitted from the public marketing landing page (a
-- separate repository/deployment, not this one). The only writer is the
-- early-access-signup Edge Function's service-role client -- the landing's
-- browser never talks to Supabase directly, and no client role (anon or
-- authenticated) is meant to reach this table at all.
--
-- RLS enabled, zero policies -- the same "fully locked down" pattern
-- already used for guest_sessions (0007_rls_policies.sql): with row
-- security on and no matching policy, anon/authenticated get 0 rows on
-- SELECT and a 42501 row-level-security violation on INSERT/UPDATE/DELETE.
-- Only service_role (which bypasses RLS entirely, per Supabase's standard
-- role setup) can reach it. No table grants are hand-managed here either,
-- consistent with this project's stated convention (see
-- 20260827122500_explicit_anon_authenticated_revokes.sql's own comment:
-- tables here intentionally rely on Supabase's standard grant plus RLS as
-- the actual boundary, never a hand-managed table grant).
begin;

create table early_access_signups (
  id uuid primary key default gen_random_uuid(),

  email text not null,
  hotel_name text not null,
  role text not null
    check (role in ('general_manager', 'front_office_manager', 'front_office', 'operations', 'owner', 'other')),
  rooms_range text not null
    check (rooms_range in ('1-20', '21-50', '51-100', '101-200', '200+')),
  main_problem text not null
    check (main_problem in ('guest_requests', 'shift_planning', 'internal_communication', 'transfer', 'restaurants_experiences', 'handover', 'other')),
  marketing_consent boolean not null default false,

  -- Attribution, all optional: the landing may not always have UTM params
  -- or may be visited directly.
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  landing_path text,

  -- Minimal CRM status, staff-managed from Supabase directly for now (no
  -- app UI reads or writes this yet) -- never reset automatically by a
  -- re-submission, see the Edge Function's upsert logic.
  status text not null default 'new'
    check (status in ('new', 'contacted', 'qualified', 'pilot', 'converted', 'rejected')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Case-insensitive uniqueness (Test@Hotel.it and test@hotel.it are the same
-- lead) via a plain functional index, matching this project's existing
-- precedent (property_job_titles' lower(trim(name)) index in
-- 20260908112932) -- no citext extension needed.
create unique index early_access_signups_email_unique_idx on early_access_signups (lower(trim(email)));

create index early_access_signups_created_at_idx on early_access_signups (created_at);
create index early_access_signups_status_idx on early_access_signups (status);

-- Reuses the shared trigger function from 0001_organizations_properties.sql
-- rather than having the Edge Function set updated_at by hand.
create trigger early_access_signups_set_updated_at
  before update on early_access_signups
  for each row execute function set_updated_at();

alter table early_access_signups enable row level security;

commit;

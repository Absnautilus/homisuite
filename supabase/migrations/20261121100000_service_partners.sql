-- service_partners: a real-world external business (a restaurant today,
-- an experience operator or spa once those modules exist) that can be
-- linked from more than one hotel's own catalog entry. Lets a single real
-- restaurant that several Homisuite hotels refer to end up as ONE row
-- here, so a future partner-facing view can aggregate its bookings across
-- every hotel that links to it -- instead of a restaurant being purely a
-- hotel-private concept the way `restaurants` is today.
--
-- This belongs in the shared core-adjacent layer, not inside the dining
-- module alone, for the same reason guest_sessions does: more than one
-- module (dining today, experiences/specials later) needs the same
-- "external partner shared across properties" concept. It does NOT
-- generalize `organizations`/`properties` themselves -- a restaurant still
-- isn't a tenant, doesn't get memberships, and this table carries no
-- property_id. That mirrors the already-decided call on Transfers'
-- TaxiCompany/Driver: an external B2B counterpart that doesn't belong in
-- the hotel-only org/property hierarchy.
--
-- Deliberately minimal for this first phase: identity only (kind + name +
-- free-text notes), no contact fields and no partner-facing login yet.
-- Per-hotel operational contact info (phone, email, commission terms)
-- stays exactly where it already lives, on restaurant_operational_profiles
-- -- that's a hotel's own relationship with the place, which can
-- legitimately differ from another hotel's relationship with the same
-- place, so it was never a candidate to move here.
begin;

create table service_partners (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('restaurant', 'experience_operator', 'spa', 'other')),
  name text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table service_partners is 'A real-world external business (restaurant, experience operator, spa...) that can be linked from more than one property''s own module-specific catalog row -- see e.g. restaurants.partner_id. Not a tenant: carries no property_id, grants no membership.';

-- Mirrors has_permission(property_id, slug), but for data that isn't
-- scoped to one property -- true if the caller has the named permission
-- on ANY property they can reach. Reuses has_permission itself (rather
-- than re-deriving the membership/role/module-enabled join) so every
-- existing OR-branch there (direct membership, org-wide membership,
-- module-enabled gate) is covered for free and can never drift out of
-- sync with the per-property check.
create function has_permission_anywhere(p_permission_slug text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from properties p where has_permission(p.id, p_permission_slug)
  );
$$;

revoke all on function has_permission_anywhere(text) from public;
grant execute on function has_permission_anywhere(text) to authenticated;

alter table service_partners enable row level security;

-- Staff-only reference data -- no anon/guest read. Same permission that
-- already gates managing a hotel's own restaurants, since linking one to
-- a partner (or creating a new partner) happens from that same screen.
create policy service_partners_manage on service_partners for all to authenticated
  using (has_permission_anywhere('dining.manage'))
  with check (has_permission_anywhere('dining.manage'));

alter table restaurants add column partner_id uuid references service_partners(id) on delete set null;
create index restaurants_partner_id_idx on restaurants(partner_id);

commit;

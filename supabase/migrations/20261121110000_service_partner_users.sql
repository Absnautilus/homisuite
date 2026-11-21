-- service_partner_users: a real partner-side account that can log into the
-- new apps/partner dashboard and see/respond to its own business's
-- reservations across every hotel that links to it.
--
-- Deliberately its own identity table, not a reuse of profiles/memberships
-- or staff_profiles: a partner user isn't hotel staff (no property_id, no
-- role in the Core permission model) and isn't scoped to one hotel's own
-- legacy schema (no hotel_id) either -- it's keyed purely on
-- service_partners.id, exactly like service_partners itself is hotel-
-- agnostic by design. Shaped like staff_profiles (auth_user_id unique,
-- name, active flag) since the same "one real person, one login, can be
-- deactivated without deleting history" need applies here too.
begin;

create table service_partner_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  service_partner_id uuid not null references service_partners(id) on delete cascade,
  full_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index service_partner_users_partner_idx on service_partner_users(service_partner_id);

comment on table service_partner_users is 'A real person at a service_partner business who can sign in to apps/partner. Not hotel staff: no property_id, no Core role -- scoped purely to one service_partners row.';

-- Mirrors has_permission_anywhere's own shape: a security-definer check
-- reusable both from other functions and directly inside an RLS USING
-- clause, so an ordinary authenticated partner user can trigger it without
-- needing a standing SELECT grant on service_partner_users for arbitrary
-- rows -- only their own (see service_partner_users_self_read below).
create function is_active_partner_user(p_service_partner_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from service_partner_users spu
    where spu.service_partner_id = p_service_partner_id
      and spu.auth_user_id = auth.uid()
      and spu.active
  );
$$;

revoke all on function is_active_partner_user(uuid) from public;
grant execute on function is_active_partner_user(uuid) to authenticated;

alter table service_partner_users enable row level security;

-- Staff with dining.manage administers partner accounts (today only via
-- the invite-service-partner-user Edge Function, which inserts through
-- this same policy using the inviting staff member's own session -- not
-- the service-role key -- so this is the one place that actually
-- authorizes the insert).
create policy service_partner_users_manage on service_partner_users for all to authenticated
  using (has_permission_anywhere('dining.manage'))
  with check (has_permission_anywhere('dining.manage'));

-- A partner user needs to read their own row to resolve "which
-- service_partner am I" on login -- additive, so it never widens what
-- staff above can already see/write.
create policy service_partner_users_self_read on service_partner_users for select to authenticated
  using (auth_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Partner read access to the dining tables the dashboard needs: a
-- reservation request, the restaurant it's for, and the hotel that made
-- it. Each is a new, additive `for select`-only policy -- the existing
-- `for all` staff policies on these tables stay the sole authority over
-- every write (see 20261015150000_platform_operational_dining_read's own
-- header for why select-only is the safe way to extend a `for all` policy).
-- ---------------------------------------------------------------------------
create policy restaurant_reservation_requests_partner_read on restaurant_reservation_requests for select to authenticated
  using (
    exists (
      select 1 from restaurants r
      where r.id = restaurant_reservation_requests.restaurant_id
        and r.partner_id is not null
        and is_active_partner_user(r.partner_id)
    )
  );

-- restaurants is already public-read (restaurants_public_read), but only
-- while active and the hotel's dining module stays enabled -- this closes
-- the gap where a partner's own reservation history would otherwise lose
-- its restaurant name the moment staff deactivate the listing.
create policy restaurants_partner_read on restaurants for select to authenticated
  using (partner_id is not null and is_active_partner_user(partner_id));

-- hotels has no public-read policy at all (unlike restaurants) -- a
-- partner needs the hotel's name to tell apart bookings from different
-- hotels in the aggregated list.
create policy hotels_partner_read on hotels for select to authenticated
  using (
    exists (
      select 1 from restaurants r
      where r.hotel_id = hotels.id
        and r.partner_id is not null
        and is_active_partner_user(r.partner_id)
    )
  );

commit;

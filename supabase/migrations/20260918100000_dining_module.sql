-- Dining module — schema, entitlement registration, and staff RLS.
--
-- Modeled directly on guest_requests' own shape (hotel_id-everywhere,
-- admin-write RLS via current_staff_role(), public read for non-sensitive
-- reference data) rather than the Core property_id/permissions system:
-- this is a sibling of guest_requests, not a Core-native feature, so it
-- reuses the same staff identity (staff_profiles) and -- crucially -- the
-- guest identity already built for it (guest_requests_guest_sessions +
-- guest_stay_from_token()). That guest-facing RPC surface is NOT built in
-- this migration (see below); this migration is schema + module
-- registration + staff-side CRUD and the reservation dashboard only.
--
-- Does NOT reuse current_staff_hotel() itself: that function
-- (20260827122100_guest_requests_authorization_wrapper.sql) deliberately
-- hardcodes has_module(..., 'guest_requests') as part of its own contract,
-- since it exists to gate guest_requests' tables specifically. Reusing it
-- here would silently make Dining depend on a property also having
-- guest_requests enabled, which nothing about this module requires. See
-- current_staff_hotel_for_module() below, the same pattern generalized.
--
-- "Modulo acquistabile separatamente": a new `modules` row plus the
-- existing property_modules entitlement table, bridged from this table's
-- legacy hotel_id to the Core property_id via legacy_property_mapping --
-- the exact bridge guest_available_modules() already uses. Unlike
-- guest_requests_entitlement.sql, no backfill runs here: this is a new,
-- separately sold module, so every property starts WITHOUT it (no
-- property_modules row at all -- hotel_has_module() below reads that as
-- false) until it's switched on for that property, one at a time, as a
-- commercial decision. That switch-on is a manual property_modules
-- insert/update, not part of this migration.
--
-- Guest self-service submission (the guest app browsing restaurants and
-- requesting a reservation) is intentionally deferred to a later
-- migration: it needs new anon-facing SECURITY DEFINER RPCs mirroring
-- create_guest_request()/guest_stay_from_token(), which is real, scoped
-- work of its own. This migration ships the part that was concretely
-- requested now -- an admin-manageable restaurant directory and a staff
-- reservation dashboard with manual entry -- without blocking on that.

begin;

-- ---------------------------------------------------------------------------
-- module registration
-- ---------------------------------------------------------------------------
insert into modules (slug, display_name, status, guest_facing)
values ('dining', 'Ristorazione', 'active', true);

-- ---------------------------------------------------------------------------
-- hotel_has_module — the same legacy_hotel_id -> platform_property_id bridge
-- guest_available_modules() already uses, generalized into a reusable
-- predicate: this module's RLS needs "is this switched on for this hotel?"
-- inline in several policies, not just a standalone listing RPC.
-- ---------------------------------------------------------------------------
create function hotel_has_module(p_hotel_id uuid, p_slug text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from legacy_property_mapping lpm
    join property_modules pm on pm.property_id = lpm.platform_property_id
    join modules m on m.id = pm.module_id
    where lpm.legacy_hotel_id = p_hotel_id
      and m.slug = p_slug
      and pm.enabled
  );
$$;

revoke all on function hotel_has_module(uuid, text) from public;
grant execute on function hotel_has_module(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- current_staff_hotel_for_module — same shape as current_staff_hotel()
-- (20260827122100_guest_requests_authorization_wrapper.sql), generalized:
-- that function hardcodes has_module(..., 'guest_requests'), which is the
-- right, deliberate gate for guest_requests' OWN tables (rooms, stays,
-- request_categories, ...) but would be the WRONG one to reuse here --
-- Dining is a separately sold module, and a property could in principle
-- have Dining without ever having bought guest_requests. This is that same
-- "core only gates whether to return the legacy hotel_id at all" pattern,
-- parameterized on module slug instead of copy-pasting a dining-specific
-- twin of the function.
-- ---------------------------------------------------------------------------
create function current_staff_hotel_for_module(p_module_slug text) returns uuid
language sql security definer stable set search_path = public as $$
  select sp.hotel_id
  from staff_profiles sp
  join legacy_property_mapping m on m.legacy_hotel_id = sp.hotel_id
  where sp.auth_user_id = auth.uid()
    and sp.active
    and has_property_access(m.platform_property_id)
    and has_module(m.platform_property_id, p_module_slug)
  limit 1;
$$;

revoke all on function current_staff_hotel_for_module(text) from public;
grant execute on function current_staff_hotel_for_module(text) to authenticated;

-- ---------------------------------------------------------------------------
-- dining_categories — admin-customizable, same shape as request_categories
-- ---------------------------------------------------------------------------
create table dining_categories (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references hotels(id),
  name text not null,
  icon text,
  active boolean not null default true,
  sort_order int not null default 0
);

create index dining_categories_hotel_idx on dining_categories(hotel_id);

-- ---------------------------------------------------------------------------
-- restaurants
-- ---------------------------------------------------------------------------
create table restaurants (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references hotels(id),
  category_id uuid not null references dining_categories(id),
  name text not null,
  description text,
  -- true = a partner/off-site restaurant the concierge merely recommends
  -- and books on the guest's behalf; false = run by the hotel itself.
  -- Both are equally valid entries in the directory (Fase 1 decision:
  -- "anche esterni").
  is_external boolean not null default true,
  -- Pasted by staff, not generated -- a plain "Apri in Google Maps" link,
  -- never validated as a real Maps URL (Fase 1 decision: no Maps API key,
  -- no format constraint beyond being a link).
  maps_url text,
  phone text,
  address text,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index restaurants_hotel_idx on restaurants(hotel_id);
create index restaurants_category_idx on restaurants(category_id);

create trigger restaurants_set_updated_at
  before update on restaurants
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- restaurant_hours — one row per opening interval, so "multiple intervals
-- per day" (e.g. lunch + dinner) is just multiple rows for the same
-- day_of_week rather than a schema change (Fase 1 decision: "intervalli
-- multipli per giorno"). day_of_week follows Postgres' own
-- extract(dow from ...) convention (0 = Sunday .. 6 = Saturday) so it
-- never needs translating when queried against a real date.
--
-- An interval spanning midnight (e.g. 22:00-01:00) is out of scope here --
-- closes_at > opens_at is enforced, so that case is modeled as two rows
-- (22:00-23:59 on one day, 00:00-01:00 on the next) rather than adding
-- overnight-spanning logic nothing has asked for yet.
-- ---------------------------------------------------------------------------
create table restaurant_hours (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  opens_at time not null,
  closes_at time not null,
  constraint restaurant_hours_closes_after_opens check (closes_at > opens_at)
);

create index restaurant_hours_restaurant_idx on restaurant_hours(restaurant_id, day_of_week);

-- ---------------------------------------------------------------------------
-- restaurant_reservation_requests — the concierge dashboard's backing
-- table. Deliberately NOT reusing guest_requests: a reservation has its
-- own fields (party size, date/time, a restaurant-facing confirmation)
-- that don't fit guest_requests' generic quantity/note/status shape, and
-- mixing them would force every existing guest_requests query and RLS
-- policy to account for rows that aren't housekeeping/reception requests
-- at all.
--
-- stay_id is nullable: a staff member entering a reservation by hand
-- (this migration's dashboard) doesn't have to first look up a stay, only
-- fill in what the paper/spreadsheet workflow already captures. It's set
-- when the row is genuinely linked to a real in-house stay -- which a
-- future guest self-service submission (see the file header) always will.
-- room_number is denormalized the same way guest_requests.room_number is,
-- but left nullable and staff-editable here (not stamped by a trigger from
-- stay_id) since a manually-entered row doesn't always have one.
-- ---------------------------------------------------------------------------
create table restaurant_reservation_requests (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references hotels(id),
  restaurant_id uuid not null references restaurants(id),
  stay_id uuid references stays(id),
  room_number text,
  guest_name text not null,
  party_size int not null check (party_size > 0),
  reservation_date date not null,
  reservation_time time not null,
  -- The external/partner restaurant's own booking reference, or staff's
  -- own -- free text, exactly like the spreadsheet's "N PRENOTAZIONE"
  -- column, never a generated sequence.
  booking_reference text,
  -- The spreadsheet's red-highlighted row was a cancellation -- 'cancelled'
  -- here is that same state, not a separate flag; the dashboard renders a
  -- 'cancelled' row in red instead of storing that as its own column.
  confirmation_status text not null default 'pending'
    check (confirmation_status in ('pending', 'confirmed', 'declined', 'cancelled')),
  -- Free-text detail alongside the structured status (e.g. "confermato per
  -- le 20:30, tavolo vicino alla finestra") -- the spreadsheet's "CONFERMA"
  -- cell carried both a state and a note, so this keeps both instead of
  -- forcing everything into the enum.
  confirmation_note text,
  special_requests text,
  staff_notes text,
  source text not null default 'staff' check (source in ('staff', 'guest')),
  created_by uuid references staff_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index restaurant_reservation_requests_hotel_idx
  on restaurant_reservation_requests(hotel_id, reservation_date);
create index restaurant_reservation_requests_restaurant_idx
  on restaurant_reservation_requests(restaurant_id);

create trigger restaurant_reservation_requests_set_updated_at
  before update on restaurant_reservation_requests
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table dining_categories enable row level security;
alter table restaurants enable row level security;
alter table restaurant_hours enable row level security;
alter table restaurant_reservation_requests enable row level security;

-- dining_categories / restaurants / restaurant_hours: public read (same
-- trust boundary as request_categories/request_types -- non-sensitive
-- reference data, hotel-scoping enforced client-side for anon), gated on
-- the module actually being enabled for that hotel so a property without
-- Dining doesn't leak a directory nobody bought.
create policy dining_categories_public_read on dining_categories for select to anon, authenticated
  using (active and hotel_has_module(hotel_id, 'dining'));

create policy dining_categories_admin_write on dining_categories for all to authenticated
  using (hotel_id = current_staff_hotel_for_module('dining') and current_staff_role() = 'admin')
  with check (hotel_id = current_staff_hotel_for_module('dining') and current_staff_role() = 'admin');

create policy restaurants_public_read on restaurants for select to anon, authenticated
  using (
    active
    and hotel_has_module(hotel_id, 'dining')
    and exists (select 1 from dining_categories dc where dc.id = category_id and dc.active)
  );

create policy restaurants_admin_write on restaurants for all to authenticated
  using (
    hotel_id = current_staff_hotel_for_module('dining')
    and current_staff_role() = 'admin'
    and exists (select 1 from dining_categories dc where dc.id = category_id and dc.hotel_id = hotel_id)
  )
  with check (
    hotel_id = current_staff_hotel_for_module('dining')
    and current_staff_role() = 'admin'
    and exists (select 1 from dining_categories dc where dc.id = category_id and dc.hotel_id = hotel_id)
  );

create policy restaurant_hours_public_read on restaurant_hours for select to anon, authenticated
  using (
    exists (
      select 1 from restaurants r
      where r.id = restaurant_id and r.active and hotel_has_module(r.hotel_id, 'dining')
    )
  );

create policy restaurant_hours_admin_write on restaurant_hours for all to authenticated
  using (
    current_staff_role() = 'admin'
    and exists (
      select 1 from restaurants r
      where r.id = restaurant_id and r.hotel_id = current_staff_hotel_for_module('dining')
    )
  )
  with check (
    current_staff_role() = 'admin'
    and exists (
      select 1 from restaurants r
      where r.id = restaurant_id and r.hotel_id = current_staff_hotel_for_module('dining')
    )
  );

-- restaurant_reservation_requests: never anon-readable (guest names/room
-- numbers, same sensitivity as `stays`) -- staff-only, scoped to whoever
-- already manages front desk/concierge duties (current_staff_manages_front_desk(),
-- the same admin + reception-operatore predicate `stays` and `reservations`
-- already use), which is also who the dashboard and manual-entry form are for.
create policy restaurant_reservation_requests_concierge on restaurant_reservation_requests for all to authenticated
  using (hotel_id = current_staff_hotel_for_module('dining') and current_staff_manages_front_desk())
  with check (hotel_id = current_staff_hotel_for_module('dining') and current_staff_manages_front_desk());

-- ---------------------------------------------------------------------------
-- grants — delete included from the start on every admin-managed table
-- (20260917110000_request_menu_delete_grants.sql already showed what
-- happens when a `for all` policy exists but the table-level grant
-- doesn't: the UI's delete silently no-ops before RLS is even reached).
-- ---------------------------------------------------------------------------
grant select on dining_categories, restaurants, restaurant_hours to anon;

grant select, insert, update, delete on dining_categories, restaurants, restaurant_hours to authenticated;
grant select, insert, update, delete on restaurant_reservation_requests to authenticated;

commit;

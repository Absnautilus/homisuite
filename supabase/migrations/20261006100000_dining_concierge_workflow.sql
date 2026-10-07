-- Dining's "Restaurant Concierge" workflow redesign — schema half.
--
-- Ground truth for every field/state added here is the interactive
-- prototype the hotel owner reviewed and approved (variant C of the "Da
-- gestire" queue), not a fresh guess at the shape: this migration makes the
-- real schema match what was already walked through screen by screen.
--
-- Scope: staff-manageable schema only (restaurant curation/operations,
-- reservation workflow states, authorized alternatives, the guest-tag
-- vocabulary, post-dinner feedback). The guest-facing anon RPC surface
-- (browsing + submitting a reservation request, leaving feedback) is a
-- separate, later migration — the same deferral 20260918100000_dining_module
-- already called out for guest self-service, now extended to also cover
-- this redesign's new "da gestire" and "alternative" affordances: those need
-- new anon-facing SECURITY DEFINER RPCs mirroring create_guest_request(),
-- real work of its own, not bundled into a schema change.
--
-- HUMAN DECISION ON RECORD — public-read catalog boundary: restaurants,
-- dining_categories, restaurant_hours and the new dining_guest_tags below
-- are anon-readable across EVERY hotel that has Dining enabled, not scoped
-- to the anon caller's own hotel — inherited unchanged from
-- 20260918100000_dining_module's own documented choice (058's own test:
-- "reading the directory is NOT hotel-isolated ... same trust boundary as
-- request_categories/request_types"). This migration deliberately keeps
-- that boundary rather than silently narrowing it, since narrowing it is a
-- product decision (does the guest app ever need to browse another
-- property's menu, e.g. a chain's sister hotel nearby?) this migration has
-- no basis to make unilaterally. Nothing sensitive rides along with it:
-- restaurant_operational_profiles (commission/contact data),
-- restaurant_reservation_alternatives, restaurant_reservation_requests and
-- restaurant_reservation_feedback all carry no anon grant at all, in this
-- migration or before it. Flagged again in this change's own PR description
-- as a decision for a human to confirm or override, not treated as settled
-- by this migration's silence.

begin;

-- ---------------------------------------------------------------------------
-- restaurants: public-safe curated fields, added directly to the existing
-- table since none of them are commercially sensitive (unlike the
-- operational fields below) — a guest seeing "ideal_for: coppie" is not a
-- business risk, and `concierge_description` is deliberately guest-facing
-- (rendered on the guest restaurant-detail screen as "Consigliato dal
-- concierge"). RLS on this table already gates read on hotel_has_module(),
-- so these inherit that same public-read boundary without a new policy.
--
-- `sort_order` (already on the table) is reused as the curated "Priorità
-- visualizzazione" field rather than adding a second ordering column — the
-- prototype's own choice of keeping exactly one display-order knob per
-- restaurant, not two that could disagree.
-- ---------------------------------------------------------------------------
alter table restaurants
  add column cuisine text,
  add column price_tier smallint check (price_tier between 1 and 4),
  add column walk_minutes smallint check (walk_minutes >= 0),
  add column short_description text,
  add column guest_tags text[] not null default '{}',
  add column is_recommended boolean not null default false,
  add column concierge_description text,
  add column ideal_for text,
  add column guest_profile text;

comment on column restaurants.price_tier is '1..4, rendered as €..€€€€.';
comment on column restaurants.is_recommended is 'Hotel-curated "Consigliato" badge — distinct from is_external/commercial status, which lives in restaurant_operational_profiles.';
comment on column restaurants.concierge_description is 'Short curated blurb shown to guests on the restaurant detail screen (the "Consigliato dal concierge" quote) — guest-facing by design, unlike restaurant_operational_profiles.';

-- ---------------------------------------------------------------------------
-- restaurant_operational_profiles — contact/commercial/internal fields,
-- split into their own table rather than more columns on `restaurants`
-- because that table carries a blanket `grant select ... to anon` (RLS
-- filters rows, not columns) — a commission rate or an internal "giorni
-- difficili" note sitting in the same row anon can already SELECT would be
-- readable by anyone hitting PostgREST directly, authenticated or not.
-- Same sensitivity class as restaurant_reservation_requests, same fix:
-- a separate, never-anon-granted table.
--
-- One row per restaurant (1:1, not a repeating history) — a profile is
-- edited in place from the restaurant's own "Operativo" tab, the same
-- shape restaurants/restaurant_hours already use for update-in-place data.
-- ---------------------------------------------------------------------------
create table restaurant_operational_profiles (
  restaurant_id uuid primary key references restaurants(id) on delete cascade,
  contact_phone text,
  contact_email text,
  contact_whatsapp text,
  preferred_contact_method text check (preferred_contact_method in ('phone', 'whatsapp', 'email')),
  contact_person text,
  -- Mirrors restaurants.is_external's intent but at the level a commercial
  -- decision actually lives: whether there's a kickback agreement at all,
  -- independent of whether the restaurant is hotel-run or off-site.
  commercial_agreement text not null default 'none'
    check (commercial_agreement in ('partner_commission', 'partner_no_commission', 'none')),
  commission_rate numeric(5, 2) check (commission_rate is null or (commission_rate >= 0 and commission_rate <= 100)),
  booking_notes text,
  difficult_times text,
  last_verified_on date,
  updated_at timestamptz not null default now()
);

create trigger restaurant_operational_profiles_set_updated_at
  before update on restaurant_operational_profiles
  for each row execute function set_updated_at();

alter table restaurant_operational_profiles enable row level security;

-- Staff-only, same capability as restaurants_admin_write (dining.manage) —
-- no anon/authenticated-public policy at all, so the default-deny RLS
-- posture plus no table grant to anon keeps this unreachable from the
-- guest app regardless of what the restaurants row it belongs to allows.
create policy restaurant_operational_profiles_admin_write on restaurant_operational_profiles for all to authenticated
  using (
    exists (
      select 1 from restaurants r
      where r.id = restaurant_id
        and r.hotel_id = current_staff_hotel_for_module('dining')
        and has_permission(legacy_hotel_property_id(r.hotel_id), 'dining.manage')
    )
  )
  with check (
    exists (
      select 1 from restaurants r
      where r.id = restaurant_id
        and r.hotel_id = current_staff_hotel_for_module('dining')
        and has_permission(legacy_hotel_property_id(r.hotel_id), 'dining.manage')
    )
  );

grant select, insert, update, delete on restaurant_operational_profiles to authenticated;
-- deliberately no grant to anon — see the file header on this table.

-- ---------------------------------------------------------------------------
-- restaurant_reservation_requests: richer workflow states.
--
-- The existing ('pending','confirmed','declined','cancelled') set is KEPT
-- as-is (not renamed/removed) so any row already in that state stays valid
-- with no backfill required — this is a live, hotel_id-scoped table that may
-- already carry real rows for Palazzo Veneziano. Four new values are ADDED
-- for the finer-grained queue the prototype's "Da gestire" section needs,
-- each standing for a distinct staff action rather than being read off the
-- generic 'pending' catch-all:
--   'new'         — just submitted, nobody has picked it up yet ("Nuova
--                   richiesta" in the queue)
--   'scheduled'   — staff-entered ahead of time, not yet due to be actioned
--                   ("Da prenotare")
--   'in_progress' — staff contacted the restaurant, awaiting its reply
--                   ("In attesa")
--   'unavailable' — the restaurant said no for that date/time; needs an
--                   authorized alternative proposed to the guest ("Non
--                   disponibile")
-- New rows (manual staff entry or, later, guest self-service) should use
-- one of these specific values going forward; 'pending' is kept reachable
-- for backward compatibility only, not as the new default.
-- ---------------------------------------------------------------------------
alter table restaurant_reservation_requests
  drop constraint restaurant_reservation_requests_confirmation_status_check;
alter table restaurant_reservation_requests
  add constraint restaurant_reservation_requests_confirmation_status_check
  check (confirmation_status in (
    'pending', 'confirmed', 'declined', 'cancelled',
    'new', 'scheduled', 'in_progress', 'unavailable'
  ));
alter table restaurant_reservation_requests
  alter column confirmation_status set default 'new';

-- Free-form guest preferences for this specific booking (e.g. "Tavolo
-- tranquillo", "Compleanno") — denormalized as text[] rather than a join
-- table, mirroring restaurants.guest_tags above: these are picked from the
-- admin-curated vocabulary below but a reservation keeps its own snapshot,
-- so renaming/retiring a tag later never rewrites historical requests.
alter table restaurant_reservation_requests
  add column guest_preference_tags text[] not null default '{}';

-- Staff member actively handling this request right now — distinct from
-- created_by (who entered/received it): the queue's "presa in carico da
-- Marco" line needs to know who owns it today, which can change (e.g.
-- handed off at shift change) independently of who originally logged it.
alter table restaurant_reservation_requests
  add column assigned_to uuid references staff_profiles(id);

-- ---------------------------------------------------------------------------
-- Tenant-safety hardening for restaurant_reservation_requests, added now
-- rather than left to RLS alone: the admin-write policy checks hotel_id
-- against the caller's own hotel, but nothing before this stopped hotel_id
-- from being paired with a restaurant_id/stay_id/assigned_to that actually
-- belongs to a DIFFERENT hotel — the plain single-column FKs on those
-- columns only prove the referenced row exists somewhere, not that it's in
-- the right tenant. A composite FK against (hotel_id, id) closes that at
-- the schema level, independent of any policy ever being misconfigured.
--
-- unique(hotel_id, id) is the standard trick to FK against a tenant-scoped
-- row: id alone is already globally unique (it's the primary key), so this
-- adds nothing new to enforce and can never fail against existing data —
-- safe to add to tables that may already carry rows.
-- Preflight, run read-only against the real Homisuite project before this
-- migration was finalized: restaurant_reservation_requests carries exactly
-- 1 row today, with 0 restaurant_id/stay_id hotel mismatches -- these
-- constraints are safe to apply against current production data as-is, no
-- cleanup migration needed first.
--
-- stay_id/assigned_to stay nullable; Postgres' default MATCH SIMPLE means a
-- NULL in either column trivially satisfies its composite FK (a manually
-- entered reservation with no linked stay, or a request nobody picked up
-- yet, isn't a cross-tenant risk by definition).
-- ---------------------------------------------------------------------------
alter table restaurants add constraint restaurants_hotel_id_id_key unique (hotel_id, id);
alter table restaurant_reservation_requests add constraint restaurant_reservation_requests_hotel_id_id_key unique (hotel_id, id);
alter table stays add constraint stays_hotel_id_id_key unique (hotel_id, id);
alter table staff_profiles add constraint staff_profiles_hotel_id_id_key unique (hotel_id, id);

alter table restaurant_reservation_requests
  add constraint restaurant_reservation_requests_restaurant_same_hotel_fkey
  foreign key (hotel_id, restaurant_id) references restaurants(hotel_id, id);
alter table restaurant_reservation_requests
  add constraint restaurant_reservation_requests_stay_same_hotel_fkey
  foreign key (hotel_id, stay_id) references stays(hotel_id, id);
alter table restaurant_reservation_requests
  add constraint restaurant_reservation_requests_assigned_to_same_hotel_fkey
  foreign key (hotel_id, assigned_to) references staff_profiles(hotel_id, id);

-- ---------------------------------------------------------------------------
-- restaurant_reservation_alternatives — the "Alternative autorizzate" list:
-- restaurants the guest pre-approved as an acceptable fallback if their
-- first choice can't seat them, in the guest's own ranked order. A junction
-- table (not a text[]/uuid[] column on the reservation) so each alternative
-- is a real FK to `restaurants` — referential integrity on something staff
-- will actually click through to from the detail panel — and so one
-- alternative can be dropped or reordered without rewriting an array.
--
-- hotel_id is denormalized here (not just reachable via reservation_id)
-- specifically so it can be the left half of a composite FK against
-- restaurants(hotel_id, id) — the structural guarantee that an alternative
-- can never point at a restaurant from a different hotel than its own
-- reservation, enforced at the constraint level rather than only by RLS.
-- It's stamped server-side by the trigger below from the reservation's own
-- hotel_id, never trusted from the caller (same posture as
-- guest_requests.room_number being trigger-stamped rather than
-- caller-supplied).
-- ---------------------------------------------------------------------------
create table restaurant_reservation_alternatives (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references hotels(id),
  reservation_id uuid not null references restaurant_reservation_requests(id) on delete cascade,
  restaurant_id uuid not null references restaurants(id),
  rank smallint not null check (rank > 0),
  created_at timestamptz not null default now(),
  unique (reservation_id, restaurant_id),
  unique (reservation_id, rank),
  foreign key (hotel_id, reservation_id) references restaurant_reservation_requests(hotel_id, id),
  foreign key (hotel_id, restaurant_id) references restaurants(hotel_id, id)
);

create index restaurant_reservation_alternatives_reservation_idx
  on restaurant_reservation_alternatives(reservation_id);

create function stamp_dining_alternative_hotel() returns trigger
language plpgsql as $$
begin
  select hotel_id into strict new.hotel_id
  from restaurant_reservation_requests where id = new.reservation_id;
  return new;
exception
  when no_data_found then
    raise exception 'reservation_not_found' using errcode = '22023';
end;
$$;

create trigger restaurant_reservation_alternatives_stamp_hotel
  before insert or update on restaurant_reservation_alternatives
  for each row execute function stamp_dining_alternative_hotel();

alter table restaurant_reservation_alternatives enable row level security;

-- hotel_id is now a trustworthy column on this table itself (stamped by the
-- trigger above, not caller-supplied), so the policy can check it directly
-- instead of joining out to restaurant_reservation_requests — same gate
-- (the right Dining hotel plus front-desk duty) as before, just simpler.
create policy restaurant_reservation_alternatives_concierge on restaurant_reservation_alternatives for all to authenticated
  using (hotel_id = current_staff_hotel_for_module('dining') and current_staff_manages_front_desk())
  with check (hotel_id = current_staff_hotel_for_module('dining') and current_staff_manages_front_desk());

grant select, insert, update, delete on restaurant_reservation_alternatives to authenticated;
-- deliberately no grant to anon — same sensitivity as the reservation itself.

-- ---------------------------------------------------------------------------
-- dining_guest_tags — the admin-curated vocabulary Impostazioni manages
-- ("gestione tag ospite"), same shape as dining_categories: a small,
-- hotel-scoped, staff-editable list the guest booking wizard will pick
-- from (once the guest-facing RPC surface exists) and that
-- guest_preference_tags snapshots from at submission time.
-- ---------------------------------------------------------------------------
create table dining_guest_tags (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references hotels(id),
  label text not null,
  active boolean not null default true,
  sort_order int not null default 0
);

create index dining_guest_tags_hotel_idx on dining_guest_tags(hotel_id);

alter table dining_guest_tags enable row level security;

create policy dining_guest_tags_public_read on dining_guest_tags for select to anon, authenticated
  using (active and hotel_has_module(hotel_id, 'dining'));

create policy dining_guest_tags_admin_write on dining_guest_tags for all to authenticated
  using (hotel_id = current_staff_hotel_for_module('dining') and has_permission(legacy_hotel_property_id(hotel_id), 'dining.manage'))
  with check (hotel_id = current_staff_hotel_for_module('dining') and has_permission(legacy_hotel_property_id(hotel_id), 'dining.manage'));

grant select on dining_guest_tags to anon;
grant select, insert, update, delete on dining_guest_tags to authenticated;

-- ---------------------------------------------------------------------------
-- restaurant_reservation_feedback — the post-dinner star rating screen.
-- One row per reservation (1:1): a guest rates the dinner they actually
-- had, not the restaurant in the abstract, so this hangs off the
-- reservation, not off restaurants directly (performance-tab aggregates
-- join through it). Insert-only from the guest's side is the intent, but
-- the anon-facing RPC that will enforce "only the stay that made this
-- booking may submit" doesn't exist yet (see file header) — this migration
-- only ships the table and the staff-read policy; it stays unreachable by
-- anon until that RPC ships, by having no anon grant at all yet.
-- ---------------------------------------------------------------------------
create table restaurant_reservation_feedback (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null unique references restaurant_reservation_requests(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

alter table restaurant_reservation_feedback enable row level security;

create policy restaurant_reservation_feedback_concierge_read on restaurant_reservation_feedback for select to authenticated
  using (
    exists (
      select 1 from restaurant_reservation_requests rr
      where rr.id = reservation_id
        and rr.hotel_id = current_staff_hotel_for_module('dining')
        and current_staff_manages_front_desk()
    )
  );

grant select on restaurant_reservation_feedback to authenticated;
-- No insert/update/delete grant to anyone yet — written only by the future
-- guest-feedback RPC (SECURITY DEFINER, like create_guest_request()).

commit;

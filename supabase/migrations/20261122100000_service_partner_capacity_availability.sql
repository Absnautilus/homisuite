-- Capacity/availability the partner manages for themselves, per the
-- user's own decision: lives on service_partners (the shared, real-world
-- business -- one capacity, one set of hours, regardless of how many
-- hotels link to it), staff-invisible for now (apps/web's Dining UI never
-- reads these columns/tables).
begin;

alter table service_partners add column seats_indoor smallint;
alter table service_partners add column seats_outdoor smallint;
-- Free-text, not yet structured ("chiuso il lunedì", "tutto prenotato
-- sabato sera") -- the structured pieces below (hours, blackout dates)
-- cover the cases worth modeling; this stays for whatever doesn't fit
-- either, the same "parti grezzo" reasoning as every other free-text
-- note column already in this schema (restaurant_operational_profiles.
-- booking_notes, service_partners.notes itself).
alter table service_partners add column availability_notes text;

-- The one write a partner can make to their own service_partners row --
-- same reasoning as partner_respond_to_reservation: a raw UPDATE grant
-- would also let them touch name/kind/notes (staff-owned), so this is the
-- sole, narrow bridge, and it resolves "which partner" from the caller's
-- own membership rather than trusting an id argument.
create function partner_update_capacity(
  p_seats_indoor smallint,
  p_seats_outdoor smallint,
  p_availability_notes text
) returns service_partners
language plpgsql security definer set search_path = public as $$
declare
  v_partner_id uuid;
  v_partner service_partners%rowtype;
begin
  select spu.service_partner_id into v_partner_id
    from service_partner_users spu
    where spu.auth_user_id = auth.uid() and spu.active;

  if v_partner_id is null then
    raise exception 'no_active_partner_account' using errcode = '42501';
  end if;

  update service_partners set
    seats_indoor = p_seats_indoor,
    seats_outdoor = p_seats_outdoor,
    availability_notes = p_availability_notes
  where id = v_partner_id
  returning * into v_partner;

  return v_partner;
end;
$$;

revoke all on function partner_update_capacity(smallint, smallint, text) from public;
grant execute on function partner_update_capacity(smallint, smallint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- service_partner_hours -- a weekly opening-hours grid the partner keeps
-- for themselves. Deliberately a separate table from restaurants'
-- restaurant_hours: that one is staff-owned, per-hotel-listing, and public
-- (restaurants_public_read) -- this one is partner-owned, per-partner,
-- and not read by anything staff/guest-facing today.
-- ---------------------------------------------------------------------------
create table service_partner_hours (
  id uuid primary key default gen_random_uuid(),
  service_partner_id uuid not null references service_partners(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  opens_at time not null,
  closes_at time not null,
  check (closes_at > opens_at)
);

create index service_partner_hours_partner_idx on service_partner_hours(service_partner_id);

alter table service_partner_hours enable row level security;

create policy service_partner_hours_manage on service_partner_hours for all to authenticated
  using (is_active_partner_user(service_partner_id))
  with check (is_active_partner_user(service_partner_id));

grant select, insert, update, delete on service_partner_hours to authenticated;

-- ---------------------------------------------------------------------------
-- service_partner_blackout_dates -- specific dates the partner marks as
-- unavailable (informational only for now -- nothing in the booking flow
-- enforces it yet, same "parti grezzo" note as availability_notes above).
-- ---------------------------------------------------------------------------
create table service_partner_blackout_dates (
  id uuid primary key default gen_random_uuid(),
  service_partner_id uuid not null references service_partners(id) on delete cascade,
  blackout_date date not null,
  note text,
  unique (service_partner_id, blackout_date)
);

create index service_partner_blackout_dates_partner_idx on service_partner_blackout_dates(service_partner_id);

alter table service_partner_blackout_dates enable row level security;

create policy service_partner_blackout_dates_manage on service_partner_blackout_dates for all to authenticated
  using (is_active_partner_user(service_partner_id))
  with check (is_active_partner_user(service_partner_id));

grant select, insert, update, delete on service_partner_blackout_dates to authenticated;

commit;

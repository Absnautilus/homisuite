-- Dining change log -- "che utente ha fatto cosa" (Fase 1 follow-up request).
-- Trigger-based rather than logged from the client: a client-side log call
-- alongside every mutation would need updating at every future call site
-- and can't see writes made any other way, while an AFTER trigger on each
-- table captures every write automatically and can't be bypassed by a
-- client simply not calling a log function.
--
-- Each trigger function is SECURITY DEFINER specifically so its own INSERT
-- into dining_change_log runs as the function owner rather than the
-- invoking staff member -- authenticated has no insert/update/delete grant
-- on dining_change_log at all, so the log can only ever be written by these
-- triggers, never directly by a client request.
--
-- actor_name is denormalized from profiles.full_name at write time (the
-- same identity table Team/AccountMenu already use), not joined at read
-- time, so the log stays readable even if that profile is later removed.

begin;

create table dining_change_log (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references hotels(id),
  entity_type text not null check (entity_type in ('category', 'restaurant', 'hours', 'reservation')),
  entity_id uuid not null,
  action text not null check (action in ('created', 'updated', 'deleted')),
  actor_profile_id uuid,
  actor_name text not null,
  summary text not null,
  created_at timestamptz not null default now()
);

create index dining_change_log_hotel_idx on dining_change_log(hotel_id, created_at desc);

-- ---------------------------------------------------------------------------
-- dining_categories / restaurants -- both have hotel_id and name directly.
-- ---------------------------------------------------------------------------
create function log_dining_named_entity_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor_name text;
  v_entity_type text;
  v_name text;
  v_hotel_id uuid;
  v_action text;
  v_entity_id uuid;
begin
  select full_name into v_actor_name from profiles where id = auth.uid();
  v_entity_type := case TG_TABLE_NAME when 'dining_categories' then 'category' else 'restaurant' end;

  if TG_OP = 'DELETE' then
    v_action := 'deleted'; v_name := OLD.name; v_hotel_id := OLD.hotel_id; v_entity_id := OLD.id;
  elsif TG_OP = 'INSERT' then
    v_action := 'created'; v_name := NEW.name; v_hotel_id := NEW.hotel_id; v_entity_id := NEW.id;
  else
    v_action := 'updated'; v_name := NEW.name; v_hotel_id := NEW.hotel_id; v_entity_id := NEW.id;
  end if;

  insert into dining_change_log (hotel_id, entity_type, entity_id, action, actor_profile_id, actor_name, summary)
  values (
    v_hotel_id, v_entity_type, v_entity_id, v_action, auth.uid(), coalesce(v_actor_name, 'Sconosciuto'),
    case v_entity_type
      when 'category' then format('Categoria "%s" %s', v_name, case v_action when 'created' then 'creata' when 'updated' then 'modificata' else 'eliminata' end)
      else format('Ristorante "%s" %s', v_name, case v_action when 'created' then 'creato' when 'updated' then 'modificato' else 'eliminato' end)
    end
  );
  return coalesce(NEW, OLD);
end;
$$;

create trigger dining_categories_log_changes after insert or update or delete on dining_categories
  for each row execute function log_dining_named_entity_change();

create trigger restaurants_log_changes after insert or update or delete on restaurants
  for each row execute function log_dining_named_entity_change();

-- ---------------------------------------------------------------------------
-- restaurant_hours -- no hotel_id/name directly, resolved via restaurant_id.
-- ---------------------------------------------------------------------------
create function log_restaurant_hours_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor_name text;
  v_restaurant_name text;
  v_hotel_id uuid;
  v_action text;
  v_entity_id uuid;
  v_restaurant_id uuid;
begin
  select full_name into v_actor_name from profiles where id = auth.uid();

  if TG_OP = 'DELETE' then
    v_action := 'deleted'; v_entity_id := OLD.id; v_restaurant_id := OLD.restaurant_id;
  else
    v_action := case TG_OP when 'INSERT' then 'created' else 'updated' end;
    v_entity_id := NEW.id; v_restaurant_id := NEW.restaurant_id;
  end if;

  select r.name, r.hotel_id into v_restaurant_name, v_hotel_id from restaurants r where r.id = v_restaurant_id;

  insert into dining_change_log (hotel_id, entity_type, entity_id, action, actor_profile_id, actor_name, summary)
  values (
    v_hotel_id, 'hours', v_entity_id, v_action, auth.uid(), coalesce(v_actor_name, 'Sconosciuto'),
    format('Orari di "%s" %s', v_restaurant_name, case v_action when 'created' then 'aggiunti' when 'updated' then 'modificati' else 'rimossi' end)
  );
  return coalesce(NEW, OLD);
end;
$$;

create trigger restaurant_hours_log_changes after insert or update or delete on restaurant_hours
  for each row execute function log_restaurant_hours_change();

-- ---------------------------------------------------------------------------
-- restaurant_reservation_requests -- a confirmation_status change (the
-- dashboard's main triage action) gets its own summary wording rather than
-- the generic "modificata", since that's the edit anyone reading the log
-- actually cares about.
-- ---------------------------------------------------------------------------
create function log_reservation_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor_name text;
  v_action text;
  v_hotel_id uuid;
  v_entity_id uuid;
  v_guest_name text;
  v_date date;
  v_summary text;
begin
  select full_name into v_actor_name from profiles where id = auth.uid();

  if TG_OP = 'DELETE' then
    v_action := 'deleted'; v_hotel_id := OLD.hotel_id; v_entity_id := OLD.id; v_guest_name := OLD.guest_name; v_date := OLD.reservation_date;
    v_summary := format('Prenotazione di %s (%s) eliminata', v_guest_name, to_char(v_date, 'DD/MM/YYYY'));
  elsif TG_OP = 'INSERT' then
    v_action := 'created'; v_hotel_id := NEW.hotel_id; v_entity_id := NEW.id; v_guest_name := NEW.guest_name; v_date := NEW.reservation_date;
    v_summary := format('Prenotazione di %s (%s) creata', v_guest_name, to_char(v_date, 'DD/MM/YYYY'));
  else
    v_action := 'updated'; v_hotel_id := NEW.hotel_id; v_entity_id := NEW.id; v_guest_name := NEW.guest_name; v_date := NEW.reservation_date;
    if OLD.confirmation_status is distinct from NEW.confirmation_status then
      v_summary := format('Prenotazione di %s (%s): stato -> %s', v_guest_name, to_char(v_date, 'DD/MM/YYYY'), NEW.confirmation_status);
    else
      v_summary := format('Prenotazione di %s (%s) modificata', v_guest_name, to_char(v_date, 'DD/MM/YYYY'));
    end if;
  end if;

  insert into dining_change_log (hotel_id, entity_type, entity_id, action, actor_profile_id, actor_name, summary)
  values (v_hotel_id, 'reservation', v_entity_id, v_action, auth.uid(), coalesce(v_actor_name, 'Sconosciuto'), v_summary);
  return coalesce(NEW, OLD);
end;
$$;

create trigger restaurant_reservation_requests_log_changes after insert or update or delete on restaurant_reservation_requests
  for each row execute function log_reservation_change();

-- ---------------------------------------------------------------------------
-- RLS -- same visibility as the reservation dashboard itself
-- (current_staff_manages_front_desk()): whoever can see/manage reservations
-- can also see who changed what across the whole module. No insert/update/
-- delete grant to authenticated at all -- see the file header.
-- ---------------------------------------------------------------------------
alter table dining_change_log enable row level security;

create policy dining_change_log_select on dining_change_log for select to authenticated
  using (hotel_id = current_staff_hotel_for_module('dining') and current_staff_manages_front_desk());

grant select on dining_change_log to authenticated;

commit;

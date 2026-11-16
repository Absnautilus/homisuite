-- Richer, action-specific wording for the Attività timeline (shown per
-- booking in BookingDetailSlideOver), replacing the generic "modificata" /
-- raw "stato -> confirmed" text with who actually did what: creation says
-- whether it was the guest themselves or which staff member entered it
-- manually (a guest-submitted request runs through an anon RPC with no
-- Supabase auth session, so auth.uid() is null and actor_name previously
-- fell back to "Sconosciuto" -- NEW.source already distinguishes this),
-- and a status change reads as the actual action taken (confermata,
-- annullata, rifiutata...) rather than the bare enum value.
create or replace function log_reservation_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor_name text;
  v_actor_label text;
  v_action text;
  v_hotel_id uuid;
  v_entity_id uuid;
  v_guest_name text;
  v_date date;
  v_summary text;
  v_status_verb text;
begin
  select full_name into v_actor_name from profiles where id = auth.uid();

  if TG_OP = 'DELETE' then
    v_action := 'deleted'; v_hotel_id := OLD.hotel_id; v_entity_id := OLD.id; v_guest_name := OLD.guest_name; v_date := OLD.reservation_date;
    v_actor_label := coalesce(v_actor_name, 'Sconosciuto');
    v_summary := format('Prenotazione di %s (%s) eliminata da %s', v_guest_name, to_char(v_date, 'DD/MM/YYYY'), v_actor_label);
  elsif TG_OP = 'INSERT' then
    v_action := 'created'; v_hotel_id := NEW.hotel_id; v_entity_id := NEW.id; v_guest_name := NEW.guest_name; v_date := NEW.reservation_date;
    v_actor_label := case when v_actor_name is not null then v_actor_name when NEW.source = 'guest' then 'ospite' else 'Sconosciuto' end;
    v_summary := format('Prenotazione di %s (%s) inserita da %s', v_guest_name, to_char(v_date, 'DD/MM/YYYY'), v_actor_label);
  else
    v_action := 'updated'; v_hotel_id := NEW.hotel_id; v_entity_id := NEW.id; v_guest_name := NEW.guest_name; v_date := NEW.reservation_date;
    v_actor_label := case when v_actor_name is not null then v_actor_name when NEW.source = 'guest' then 'ospite' else 'Sconosciuto' end;
    if OLD.confirmation_status is distinct from NEW.confirmation_status then
      v_status_verb := case NEW.confirmation_status
        when 'confirmed' then 'prenotata'
        when 'cancelled' then 'annullata'
        when 'declined' then 'rifiutata'
        when 'unavailable' then 'segnata come non disponibile'
        when 'in_progress' then 'presa in carico'
        when 'scheduled' then 'programmata'
        when 'new' then 'riaperta come nuova richiesta'
        when 'pending' then 'rimessa in attesa'
        else NEW.confirmation_status
      end;
      v_summary := format('Prenotazione di %s (%s) %s da %s', v_guest_name, to_char(v_date, 'DD/MM/YYYY'), v_status_verb, v_actor_label);
    else
      v_summary := format('Prenotazione di %s (%s) modificata da %s', v_guest_name, to_char(v_date, 'DD/MM/YYYY'), v_actor_label);
    end if;
  end if;

  insert into dining_change_log (hotel_id, entity_type, entity_id, action, actor_profile_id, actor_name, summary)
  values (v_hotel_id, 'reservation', v_entity_id, v_action, auth.uid(), v_actor_label, v_summary);
  return coalesce(NEW, OLD);
end;
$$;

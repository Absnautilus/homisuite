-- Deleting a restaurant cascades to its own restaurant_hours rows in the
-- same statement. By the time restaurant_hours_log_changes' AFTER DELETE
-- trigger runs on each cascaded hour row, the parent restaurant is already
-- gone, so log_restaurant_hours_change()'s lookup of its name/hotel_id
-- found nothing and inserted a null hotel_id into dining_change_log --
-- violating its not-null constraint and aborting the whole restaurant
-- delete. This was silent until restaurants routinely carried hours (the
-- Google Maps import), at which point almost every restaurant delete
-- started failing.
--
-- Fix: skip logging this specific case instead of crashing -- the
-- restaurant's own deletion is already recorded by restaurants_log_changes,
-- so a redundant "orari rimossi" entry for a restaurant that no longer
-- exists isn't needed anyway.
create or replace function public.log_restaurant_hours_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  if v_hotel_id is null then
    return coalesce(NEW, OLD);
  end if;

  insert into dining_change_log (hotel_id, entity_type, entity_id, action, actor_profile_id, actor_name, summary)
  values (
    v_hotel_id, 'hours', v_entity_id, v_action, auth.uid(), coalesce(v_actor_name, 'Sconosciuto'),
    format('Orari di "%s" %s', v_restaurant_name, case v_action when 'created' then 'aggiunti' when 'updated' then 'modificati' else 'rimossi' end)
  );
  return coalesce(NEW, OLD);
end;
$function$;

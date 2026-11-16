-- current_staff_role() mapped rank 40 ("Organization Admin") -> master,
-- 30 ("Property Admin") -> admin, 10 ("Receptionist") -> operatore, but had
-- no case for rank 20 ("Manager") at all -- it silently fell to null. Its
-- only consumer, current_staff_manages_front_desk(), requires
-- 'admin'/'master' (or 'operatore' in the reception department), so a
-- Manager got null from both and was silently denied -- not an error,
-- just an empty dining_change_log every time, however much activity
-- their own actions had actually logged (reported: Chiara Pugnalin,
-- rank 20, changing a reservation's status produced real rows in
-- dining_change_log that she then couldn't see in the Attività panel).
-- A Manager is a property-level supervisory role and belongs with
-- admin/master here, not gated behind a department check meant for
-- front-desk staff.
create or replace function public.current_staff_role()
 returns staff_role
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case current_actor_role_rank(m.platform_property_id)
    when 40 then 'master'::staff_role
    when 30 then 'admin'::staff_role
    when 20 then 'admin'::staff_role
    when 10 then 'operatore'::staff_role
    else null
  end
  from staff_profiles sp
  join legacy_property_mapping m on m.legacy_hotel_id = sp.hotel_id
  where sp.auth_user_id = auth.uid()
    and sp.active
  limit 1;
$function$;

-- partner_respond_to_reservation — the one write a partner-side account
-- (service_partner_users, see the previous migration) is allowed to make:
-- confirm or decline a reservation for a restaurant linked to their own
-- service_partner.
--
-- SECURITY DEFINER, not INVOKER: unlike save_restaurant_management (staff
-- already hold a `for all` RLS policy on this table, so invoker is enough),
-- a partner user has only the additive SELECT policy from the previous
-- migration -- no UPDATE policy exists for them at all, deliberately, so
-- they can't be given raw column access (staff_notes, assigned_to,
-- guest_preference_tags, etc. must stay staff-only). This function is the
-- sole, narrow bridge: it writes exactly confirmation_status and
-- confirmation_note, nothing else, after checking the caller's own
-- partner membership itself -- mirroring create_dining_reservation_request
-- (20261006110000), the other place in this module that bridges a
-- privilege gap this way.
begin;

create function partner_respond_to_reservation(
  p_request_id uuid,
  p_status text,
  p_note text default null
) returns restaurant_reservation_requests
language plpgsql security definer set search_path = public as $$
declare
  v_partner_id uuid;
  v_request restaurant_reservation_requests%rowtype;
begin
  if p_status not in ('confirmed', 'declined') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select r.partner_id into v_partner_id
    from restaurant_reservation_requests rr
    join restaurants r on r.id = rr.restaurant_id
    where rr.id = p_request_id;

  if v_partner_id is null then
    raise exception 'reservation_not_found_or_not_linked' using errcode = '22023';
  end if;

  if not is_active_partner_user(v_partner_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  update restaurant_reservation_requests set
    confirmation_status = p_status,
    confirmation_note = p_note
  where id = p_request_id
  returning * into v_request;

  return v_request;
end;
$$;

revoke all on function partner_respond_to_reservation(uuid, text, text) from public;
grant execute on function partner_respond_to_reservation(uuid, text, text) to authenticated;

commit;

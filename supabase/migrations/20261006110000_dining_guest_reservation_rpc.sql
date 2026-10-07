-- Dining's guest self-service submission — the anon-facing RPC surface
-- 20260918100000_dining_module deliberately deferred ("needs new anon-
-- facing SECURITY DEFINER RPCs mirroring create_guest_request()"),
-- extended once more by 20261006100000_dining_concierge_workflow's own
-- deferral note for the richer workflow this redesign adds.
--
-- Mirrors create_guest_request() (20260827120100_guest_requests_functions)
-- exactly: reuse guest_stay_from_token() for identity (dining has no guest
-- auth of its own, by design -- see 20260918100000's header), the same
-- 'invalid_session'/28000 contract on a bad/expired token, the same
-- last_seen_at touch, the same "stamp room_number server-side, never trust
-- the caller" posture guest_requests' own insert trigger already enforces.
--
-- Scope matches what the guest UI (apps/guest's DiningFlow) actually
-- collects today: restaurant, date, time, party size, an optional free-text
-- note. Authorized-alternatives selection and the guest-tag picker are a
-- later UI iteration, not added here speculatively.
begin;

create function create_dining_reservation_request(
  p_token text,
  p_restaurant_id uuid,
  p_reservation_date date,
  p_reservation_time time,
  p_party_size int,
  p_special_requests text default null
) returns restaurant_reservation_requests
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_stay stays%rowtype;
  v_room_number text;
  v_request restaurant_reservation_requests%rowtype;
begin
  v_stay := guest_stay_from_token(p_token);
  if v_stay.id is null then
    raise exception 'invalid_session' using errcode = '28000';
  end if;

  -- Defense in depth: a guest with an otherwise-valid session at a hotel
  -- that never bought Dining (or bought it and later disabled it) still
  -- can't write here, matching restaurants_public_read's own gate.
  if not hotel_has_module(v_stay.hotel_id, 'dining') then
    raise exception 'dining_not_enabled' using errcode = '42501';
  end if;

  if not exists (
    select 1 from restaurants where id = p_restaurant_id and hotel_id = v_stay.hotel_id and active
  ) then
    raise exception 'restaurant_not_found' using errcode = '22023';
  end if;

  if p_reservation_date is null then
    raise exception 'invalid_reservation_date' using errcode = '22023';
  end if;

  if p_reservation_time is null then
    raise exception 'invalid_reservation_time' using errcode = '22023';
  end if;

  if p_party_size is null or p_party_size < 1 or p_party_size > 20 then
    raise exception 'invalid_party_size' using errcode = '22023';
  end if;

  if p_special_requests is not null and char_length(p_special_requests) > 500 then
    raise exception 'special_requests_too_long' using errcode = '22023';
  end if;

  if p_reservation_date < current_date then
    raise exception 'reservation_in_past' using errcode = '22023';
  end if;

  -- A guest has no reason to book dining after they've already checked
  -- out, and the stay's own check_out_at is a real, data-driven bound
  -- (not an arbitrary constant) -- it also doubles as the "too far in the
  -- future" cap the review asked for, since no stay runs for years.
  if p_reservation_date > v_stay.check_out_at::date then
    raise exception 'reservation_after_checkout' using errcode = '22023';
  end if;

  update guest_requests_guest_sessions set last_seen_at = now()
    where token_hash = encode(digest(p_token, 'sha256'), 'hex');

  -- Idempotency: a double-tap or a retried request after a dropped
  -- response for the exact same table/date/time returns the request
  -- already on file instead of creating a near-duplicate -- no new
  -- dedup infrastructure, just a lookup against the table this function
  -- already writes to.
  select * into v_request
    from restaurant_reservation_requests
    where stay_id = v_stay.id
      and restaurant_id = p_restaurant_id
      and reservation_date = p_reservation_date
      and reservation_time = p_reservation_time
      and confirmation_status <> 'cancelled'
    order by created_at desc
    limit 1;
  if v_request.id is not null then
    return v_request;
  end if;

  select r.room_number into v_room_number from rooms r where r.id = v_stay.room_id;

  insert into restaurant_reservation_requests (
    hotel_id, restaurant_id, stay_id, room_number, guest_name, party_size,
    reservation_date, reservation_time, special_requests, source, confirmation_status
  ) values (
    v_stay.hotel_id, p_restaurant_id, v_stay.id, v_room_number, v_stay.guest_last_name, p_party_size,
    p_reservation_date, p_reservation_time, p_special_requests, 'guest', 'new'
  )
  returning * into v_request;

  return v_request;
end;
$$;

-- Same posture as every other guest RPC: revoked from PUBLIC by default,
-- re-granted to anon explicitly and only here.
revoke all on function create_dining_reservation_request(text, uuid, date, time, int, text) from public;
grant execute on function create_dining_reservation_request(text, uuid, date, time, int, text) to anon;

commit;

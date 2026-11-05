-- Closes the gap 20261006100000_dining_concierge_workflow's own header left
-- open: restaurant_reservation_feedback (the post-dinner star rating) has
-- shipped as a table with a staff-read policy since that migration, but no
-- anon grant and no RPC ever gave a guest a way to actually write one --
-- "written only by the future guest RPC" was never followed up. The staff
-- side (getFeedback() in apps/web) was already reading from it, just
-- never had anything to find.
--
-- Two RPCs, both mirroring create_dining_reservation_request's own
-- established shape exactly (guest_stay_from_token() for identity, the
-- same 'invalid_session' contract, same posture: revoked from PUBLIC,
-- granted to anon only here):
--
--   list_my_dining_reservations(p_token) -- so the guest app has something
--   to show a "rate your dinner" prompt against in the first place. Mirrors
--   list_my_requests(p_token) (20260827120100) exactly.
--
--   create_dining_reservation_feedback(p_token, p_reservation_id, p_rating,
--   p_comment) -- the actual write. Only for a reservation that belongs to
--   the calling stay, is 'confirmed' (not just requested -- declining/
--   cancelling/never-happening reservations have nothing to rate), and
--   whose date has passed. "Has passed" is a plain date comparison
--   (reservation_date < current_date), matching every other date check in
--   this module (e.g. create_dining_reservation_request's own
--   reservation_in_past/reservation_after_checkout) -- deliberately not
--   combined with reservation_time against now(), which would require
--   picking a timezone this module otherwise never needs to reason about.
--   An upsert (on conflict (reservation_id)) rather than insert-only: the
--   guest can revise a rating they just submitted before closing the app,
--   the same way editing right after submit is normal on any review form.
begin;

-- restaurant_reservation_feedback has no anon grant at all (by design, see
-- 20261006100000's own comment) and this function deliberately keeps it
-- that way rather than opening a new RLS policy for it -- a guest's only
-- read path onto her own feedback is through this RPC, same as every other
-- guest-facing read here already goes through a function rather than a
-- direct table grant. A plain `returns setof restaurant_reservation_requests`
-- can't also carry the left-joined feedback columns, hence this composite
-- type instead.
create type dining_reservation_with_feedback as (
  id uuid,
  hotel_id uuid,
  restaurant_id uuid,
  reservation_date date,
  reservation_time time,
  party_size int,
  confirmation_status text,
  special_requests text,
  created_at timestamptz,
  feedback_rating smallint,
  feedback_comment text
);

create function list_my_dining_reservations(p_token text) returns setof dining_reservation_with_feedback
language plpgsql security definer stable set search_path = public as $$
declare
  v_stay stays%rowtype;
begin
  v_stay := guest_stay_from_token(p_token);
  if v_stay.id is null then
    raise exception 'invalid_session' using errcode = '28000';
  end if;

  return query
    select r.id, r.hotel_id, r.restaurant_id, r.reservation_date, r.reservation_time,
           r.party_size, r.confirmation_status, r.special_requests, r.created_at,
           f.rating, f.comment
    from restaurant_reservation_requests r
    left join restaurant_reservation_feedback f on f.reservation_id = r.id
    where r.stay_id = v_stay.id
    order by r.reservation_date desc, r.reservation_time desc;
end;
$$;

create function create_dining_reservation_feedback(
  p_token text,
  p_reservation_id uuid,
  p_rating smallint,
  p_comment text default null
) returns restaurant_reservation_feedback
language plpgsql security definer set search_path = public as $$
declare
  v_stay stays%rowtype;
  v_reservation restaurant_reservation_requests%rowtype;
  v_feedback restaurant_reservation_feedback%rowtype;
begin
  v_stay := guest_stay_from_token(p_token);
  if v_stay.id is null then
    raise exception 'invalid_session' using errcode = '28000';
  end if;

  select * into v_reservation
    from restaurant_reservation_requests
    where id = p_reservation_id and stay_id = v_stay.id;
  if v_reservation.id is null then
    raise exception 'reservation_not_found' using errcode = '22023';
  end if;

  if v_reservation.confirmation_status <> 'confirmed' then
    raise exception 'reservation_not_confirmed' using errcode = '22023';
  end if;

  if v_reservation.reservation_date >= current_date then
    raise exception 'reservation_not_yet_completed' using errcode = '22023';
  end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'invalid_rating' using errcode = '22023';
  end if;

  if p_comment is not null and char_length(p_comment) > 500 then
    raise exception 'comment_too_long' using errcode = '22023';
  end if;

  insert into restaurant_reservation_feedback (reservation_id, rating, comment)
  values (p_reservation_id, p_rating, p_comment)
  on conflict (reservation_id) do update
    set rating = excluded.rating, comment = excluded.comment
  returning * into v_feedback;

  return v_feedback;
end;
$$;

revoke all on function list_my_dining_reservations(text) from public;
grant execute on function list_my_dining_reservations(text) to anon;

revoke all on function create_dining_reservation_feedback(text, uuid, smallint, text) from public;
grant execute on function create_dining_reservation_feedback(text, uuid, smallint, text) to anon;

commit;

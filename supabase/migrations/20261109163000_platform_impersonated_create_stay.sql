-- Admin Master Housekeeping: narrowly scoped and audited stay creation while
-- "viewing as" an active property staff member with front-desk authority.
-- No changes to stays INSERT RLS, no fake staff identity, no blanket bypass.
begin;

create function public.platform_impersonated_create_stay(
  p_property_id uuid,
  p_room_id uuid,
  p_guest_last_name text,
  p_check_in_at timestamptz,
  p_check_out_at timestamptz,
  p_acting_as_membership_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_hotel_id uuid;
  v_room_number text;
  v_target_profile_id uuid;
  v_rank smallint;
  v_department text;
  v_stay public.stays%rowtype;
begin
  -- This checks the calling admin's live identity, MFA, permission and
  -- non-expired, single-property impersonation session on every invocation.
  if not public.platform_impersonated_action_allowed(p_property_id, p_acting_as_membership_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  select lm.legacy_hotel_id into v_hotel_id
  from public.legacy_property_mapping lm
  where lm.platform_property_id = p_property_id;
  if v_hotel_id is null then
    raise exception 'property_not_mapped' using errcode = '22023';
  end if;

  if not public.has_module(p_property_id, 'guest_requests') then
    raise exception 'housekeeping_not_enabled' using errcode = '42501';
  end if;

  -- Only the selected member, not Admin Master, determines functional
  -- authority. Same front-desk role mapping as current_staff_role() /
  -- current_staff_manages_front_desk(), plus the module denial override.
  select m.profile_id, ro.rank,
         coalesce(psd.housekeeping_department, sp.department)::text
    into v_target_profile_id, v_rank, v_department
  from public.memberships m
  join public.roles ro on ro.id = m.role_id
  join public.staff_profiles sp
    on sp.auth_user_id = m.profile_id and sp.hotel_id = v_hotel_id and sp.active
  left join public.property_staff_details psd
    on psd.profile_id = m.profile_id and psd.property_id = p_property_id
  where m.id = p_acting_as_membership_id
    and m.property_id = p_property_id
    and m.status = 'active';

  if v_target_profile_id is null
     or not (v_rank in (30, 40) or (v_rank = 10 and v_department = 'reception')) then
    raise exception 'acting_as_cannot_manage_stays' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.membership_module_access mma
    join public.modules mo on mo.id = mma.module_id
    where mma.membership_id = p_acting_as_membership_id
      and mo.slug = 'guest_requests'
      and mma.enabled = false
  ) then
    raise exception 'acting_as_housekeeping_disabled' using errcode = '42501';
  end if;

  select ro.room_number into v_room_number
  from public.rooms ro
  where ro.id = p_room_id and ro.hotel_id = v_hotel_id and ro.active;
  if v_room_number is null then
    raise exception 'room_not_found_in_property' using errcode = '22023';
  end if;

  if p_guest_last_name is null or length(trim(p_guest_last_name)) = 0 then
    raise exception 'guest_name_required' using errcode = '22023';
  end if;

  if p_check_in_at is null or p_check_out_at is null
     or p_check_out_at <= p_check_in_at then
    raise exception 'invalid_stay_dates' using errcode = '22023';
  end if;

  -- Existing exclusion constraint stays_no_overlapping_active stays in force.
  -- The creator is NOT the viewed-as staff member: audit attributes this
  -- action to the true auth.uid() (Admin Master), never to an employee.
  insert into public.stays (hotel_id, room_id, guest_last_name, check_in_at, check_out_at)
  values (v_hotel_id, p_room_id, trim(p_guest_last_name), p_check_in_at, p_check_out_at)
  returning * into v_stay;

  perform public.log_platform_action(
    'platform.impersonated_stay_created', 'stay', v_stay.id,
    jsonb_build_object(
      'property_id', p_property_id,
      'acting_as_membership_id', p_acting_as_membership_id,
      'acting_as_profile_id', v_target_profile_id,
      'room_id', p_room_id
    )
  );

  return jsonb_build_object(
    'id', v_stay.id,
    'room_id', v_stay.room_id,
    'guest_last_name', v_stay.guest_last_name,
    'guest_pin', v_stay.guest_pin,
    'check_in_at', v_stay.check_in_at,
    'check_out_at', v_stay.check_out_at,
    'status', v_stay.status,
    'rooms', jsonb_build_object('room_number', v_room_number)
  );
end;
$$;

revoke all on function public.platform_impersonated_create_stay(uuid,uuid,text,timestamptz,timestamptz,uuid) from public, anon;
grant execute on function public.platform_impersonated_create_stay(uuid,uuid,text,timestamptz,timestamptz,uuid) to authenticated;

commit;

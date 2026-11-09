-- Staff administrators may manage shared hotel inventory without property-settings privileges.
-- This is an interim compatibility grant for the existing admin-tier core.staff.manage permission.
begin;
create or replace function public.core_hotel_id_for_property(p_property_id uuid)
returns uuid language sql stable security definer set search_path = ''
as $$
  select lm.legacy_hotel_id
  from public.legacy_property_mapping lm
  where lm.platform_property_id = p_property_id
    and auth.uid() is not null
    and (
      public.profile_has_permission(auth.uid(), p_property_id, 'core.property.manage')
      or public.profile_has_permission(auth.uid(), p_property_id, 'core.staff.manage')
    )
  limit 1
$$;
revoke all on function public.core_hotel_id_for_property(uuid) from public, anon;
grant execute on function public.core_hotel_id_for_property(uuid) to authenticated;
create policy rooms_core_staff_manage_select on public.rooms for select to authenticated
using (public.profile_has_permission((select auth.uid()), public.legacy_hotel_property_id(hotel_id), 'core.staff.manage'));
create policy rooms_core_staff_manage_insert on public.rooms for insert to authenticated
with check (public.profile_has_permission((select auth.uid()), public.legacy_hotel_property_id(hotel_id), 'core.staff.manage'));
create policy rooms_core_staff_manage_update on public.rooms for update to authenticated
using (public.profile_has_permission((select auth.uid()), public.legacy_hotel_property_id(hotel_id), 'core.staff.manage'))
with check (public.profile_has_permission((select auth.uid()), public.legacy_hotel_property_id(hotel_id), 'core.staff.manage'));
create policy stays_core_staff_manage_select on public.stays for select to authenticated
using (public.profile_has_permission((select auth.uid()), public.legacy_hotel_property_id(hotel_id), 'core.staff.manage'));
create policy stays_core_staff_manage_insert on public.stays for insert to authenticated
with check (public.profile_has_permission((select auth.uid()), public.legacy_hotel_property_id(hotel_id), 'core.staff.manage'));
create policy stays_core_staff_manage_update on public.stays for update to authenticated
using (public.profile_has_permission((select auth.uid()), public.legacy_hotel_property_id(hotel_id), 'core.staff.manage'))
with check (public.profile_has_permission((select auth.uid()), public.legacy_hotel_property_id(hotel_id), 'core.staff.manage'));
commit;

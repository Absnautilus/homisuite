-- Hotel Core owns room inventory and stays independently of guest_requests.
-- Preserve all existing RLS policies, stay overlap constraints, and data.
begin;

-- Resolve the existing legacy hotel id from a Core property without a module
-- entitlement. Only members with explicit Core property-management rights
-- can use this bridge. Platform operational read access alone is insufficient.
create or replace function public.core_hotel_id_for_property(p_property_id uuid)
returns uuid language sql stable security definer
set search_path = ''
as $$
  select lm.legacy_hotel_id
  from public.legacy_property_mapping lm
  where lm.platform_property_id = p_property_id
    and auth.uid() is not null
    and public.profile_has_permission(auth.uid(), p_property_id, 'core.property.manage')
  limit 1
$$;
revoke all on function public.core_hotel_id_for_property(uuid) from public, anon;
grant execute on function public.core_hotel_id_for_property(uuid) to authenticated;

-- Existing Core permission is property-scoped and independent of module
-- activation. These are additive policies: legacy Housekeeping flows keep
-- working until their callers have migrated to Core.
create policy rooms_core_property_manage_select on public.rooms
for select to authenticated
using (
  public.profile_has_permission(
    (select auth.uid()), public.legacy_hotel_property_id(hotel_id), 'core.property.manage'
  )
);
create policy rooms_core_property_manage_insert on public.rooms
for insert to authenticated
with check (
  public.profile_has_permission(
    (select auth.uid()), public.legacy_hotel_property_id(hotel_id), 'core.property.manage'
  )
);
create policy rooms_core_property_manage_update on public.rooms
for update to authenticated
using (
  public.profile_has_permission(
    (select auth.uid()), public.legacy_hotel_property_id(hotel_id), 'core.property.manage'
  )
)
with check (
  public.profile_has_permission(
    (select auth.uid()), public.legacy_hotel_property_id(hotel_id), 'core.property.manage'
  )
);
create policy rooms_core_property_manage_delete on public.rooms
for delete to authenticated
using (
  public.profile_has_permission(
    (select auth.uid()), public.legacy_hotel_property_id(hotel_id), 'core.property.manage'
  )
);

create policy stays_core_property_manage_select on public.stays
for select to authenticated
using (
  public.profile_has_permission(
    (select auth.uid()), public.legacy_hotel_property_id(hotel_id), 'core.property.manage'
  )
);
create policy stays_core_property_manage_insert on public.stays
for insert to authenticated
with check (
  public.profile_has_permission(
    (select auth.uid()), public.legacy_hotel_property_id(hotel_id), 'core.property.manage'
  )
);
create policy stays_core_property_manage_update on public.stays
for update to authenticated
using (
  public.profile_has_permission(
    (select auth.uid()), public.legacy_hotel_property_id(hotel_id), 'core.property.manage'
  )
)
with check (
  public.profile_has_permission(
    (select auth.uid()), public.legacy_hotel_property_id(hotel_id), 'core.property.manage'
  )
);
create policy stays_core_property_manage_delete on public.stays
for delete to authenticated
using (
  public.profile_has_permission(
    (select auth.uid()), public.legacy_hotel_property_id(hotel_id), 'core.property.manage'
  )
);
commit;

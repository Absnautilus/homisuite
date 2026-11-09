-- Match the Core Rooms deletion action to the same property-scoped staff authorization as create/update.
create policy rooms_core_staff_manage_delete on public.rooms
for delete to authenticated
using (public.profile_has_permission((select auth.uid()), public.legacy_hotel_property_id(hotel_id), 'core.staff.manage'));

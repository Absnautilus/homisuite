-- Dining's admin-write policies (20260918100000_dining_module.sql,
-- 20260918120000_dining_admin_write_master_access.sql) gate on
-- current_staff_role() in ('admin', 'master') -- a legacy vocabulary that
-- happens to be *derived* from Core rank (current_staff_role() itself reads
-- current_actor_role_rank(), not a stale staff_profiles.role column) but
-- still hard-codes rank thresholds into Dining's own policies instead of
-- naming an explicit, module-scoped Core capability the way Turni's own
-- schema does (has_permission(property_id, 'shifts.manage')).
--
-- This migration gives Dining the same shape: a 'dining' permission grant
-- that role_permissions can assign per role, checked via has_permission().
-- has_permission() already ORs a property-scoped membership with an
-- org-wide one against the same permission (see 0006_rls_helpers.sql), so
-- granting 'dining.manage' to both property_admin and organization_admin
-- reproduces the old admin/master equivalence exactly -- no new grantee,
-- no removed one.
--
-- Dining's tables are still hotel_id-scoped (legacy_property_mapping
-- bridges them to property_id/organization_id, same as guest_requests),
-- so a small resolver is added for has_permission() to key off of.

begin;

create or replace function legacy_hotel_property_id(p_hotel_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select platform_property_id from legacy_property_mapping where legacy_hotel_id = p_hotel_id;
$$;

revoke all on function legacy_hotel_property_id(uuid) from public;
grant execute on function legacy_hotel_property_id(uuid) to authenticated;

insert into permissions (slug, module_id)
select 'dining.manage', module.id
from modules module
where module.slug = 'dining'
on conflict (slug) do update set module_id = excluded.module_id;

insert into role_permissions (role_id, permission_id)
select role.id, permission.id
from roles role
join permissions permission on true
where (role.slug, permission.slug) in (
  ('property_admin', 'dining.manage'),
  ('organization_admin', 'dining.manage')
)
on conflict do nothing;

drop policy dining_categories_admin_write on dining_categories;
create policy dining_categories_admin_write on dining_categories for all to authenticated
  using (hotel_id = current_staff_hotel_for_module('dining') and has_permission(legacy_hotel_property_id(hotel_id), 'dining.manage'))
  with check (hotel_id = current_staff_hotel_for_module('dining') and has_permission(legacy_hotel_property_id(hotel_id), 'dining.manage'));

drop policy restaurants_admin_write on restaurants;
create policy restaurants_admin_write on restaurants for all to authenticated
  using (
    hotel_id = current_staff_hotel_for_module('dining')
    and has_permission(legacy_hotel_property_id(hotel_id), 'dining.manage')
    and exists (select 1 from dining_categories dc where dc.id = category_id and dc.hotel_id = hotel_id)
  )
  with check (
    hotel_id = current_staff_hotel_for_module('dining')
    and has_permission(legacy_hotel_property_id(hotel_id), 'dining.manage')
    and exists (select 1 from dining_categories dc where dc.id = category_id and dc.hotel_id = hotel_id)
  );

drop policy restaurant_hours_admin_write on restaurant_hours;
create policy restaurant_hours_admin_write on restaurant_hours for all to authenticated
  using (
    exists (
      select 1 from restaurants r
      where r.id = restaurant_id
        and r.hotel_id = current_staff_hotel_for_module('dining')
        and has_permission(legacy_hotel_property_id(r.hotel_id), 'dining.manage')
    )
  )
  with check (
    exists (
      select 1 from restaurants r
      where r.id = restaurant_id
        and r.hotel_id = current_staff_hotel_for_module('dining')
        and has_permission(legacy_hotel_property_id(r.hotel_id), 'dining.manage')
    )
  );

-- restaurant_reservation_requests_concierge is unchanged: it composes on
-- current_staff_manages_front_desk() (admin OR reception-operatore), a
-- different, shared front-desk concept also used by stays/reservations --
-- out of scope for this Dining-only capability realignment.

comment on function legacy_hotel_property_id(uuid) is
  'Resolves the Core property_id a legacy hotel_id maps to, for RLS policies on still hotel_id-scoped tables that need to call has_permission()/has_organization_permission().';

commit;

-- Per-property override of whether a guest-facing module's services show
-- in THIS property's guest app. modules.guest_facing (platform-wide) and
-- property_modules.enabled (is the module on for this property at all)
-- already existed, but a property had no way to turn off guest visibility
-- specifically while keeping the module enabled for staff. Defaults to
-- true so existing behavior doesn't change until a property explicitly
-- opts out.
alter table property_modules add column if not exists guest_enabled boolean not null default true;

create or replace function public.guest_available_modules(p_hotel_id uuid)
returns table(slug text, display_name text)
language sql
stable security definer
set search_path to 'public'
as $$
  select m.slug, m.display_name
  from legacy_property_mapping lpm
  join property_modules pm on pm.property_id = lpm.platform_property_id
  join modules m on m.id = pm.module_id
  where lpm.legacy_hotel_id = p_hotel_id
    and pm.enabled
    and pm.guest_enabled
    and m.guest_facing
    and m.status <> 'in_development'
    and (m.status <> 'testing' or pm.testing_access)
  order by m.display_name;
$$;

create or replace function public.set_property_module_guest_enabled(p_property_id uuid, p_module_id uuid, p_enabled boolean)
returns void
language plpgsql
set search_path to 'public'
as $function$
begin
  if not has_permission(p_property_id, 'core.property.manage') then
    raise exception 'insufficient_permission' using errcode = '42501';
  end if;

  insert into property_modules (property_id, module_id, guest_enabled)
  values (p_property_id, p_module_id, p_enabled)
  on conflict (property_id, module_id) do update set guest_enabled = excluded.guest_enabled;
end;
$function$;

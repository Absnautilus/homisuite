-- guest_available_modules still hard-coded m.status = 'active' from before
-- the module lifecycle rework, so as soon as a guest-facing module (dining,
-- guest_requests) moved to 'testing' or 'beta' it silently vanished from
-- the guest app ("Nessun servizio disponibile al momento"), even for
-- properties the admin had explicitly opted in. Bring it in line with the
-- same visibility rule getEnabledModules already uses tenant-side.
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
    and m.guest_facing
    and m.status <> 'in_development'
    and (m.status <> 'testing' or pm.testing_access)
  order by m.display_name;
$$;

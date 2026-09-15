-- A dedicated Storage bucket for property logos, uploaded from the Team ->
-- "Informazioni struttura" modal. Objects are stored as
-- `<property_id>/logo.png` — the property id as the top-level "folder" is
-- the standard Supabase Storage multi-tenancy idiom, and it's what every
-- policy below keys off. The bucket is public so the guest apps and the
-- staff dashboard can both just use the object's public URL directly, with
-- no signed URLs to mint or refresh — a hotel logo isn't sensitive.
--
-- Authorization mirrors properties_update / property_modules_update exactly
-- (0007_rls_policies.sql): editing a property's logo requires the same
-- has_permission(property_id, 'core.property.manage') already used to edit
-- the property's other fields, so this can live in the same modal as the
-- rest of "Informazioni struttura" with no separate permission check
-- needed. Reads are gated to any staff member with access to the property
-- (has_property_access) rather than left fully public, even though the
-- bucket itself is public -- this only affects the authenticated dashboard
-- read path (e.g. listing the current object to render a preview); the
-- bucket's public flag is what serves the logo to anon guests via its
-- public URL, which bypasses object-level RLS entirely and is unaffected
-- by the policies below.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('property-logos', 'property-logos', true, 2097152, array['image/png'])
on conflict (id) do nothing;

-- Pulls the property id out of an object's path (its top-level folder) and
-- returns null instead of raising for anything that isn't a well-formed
-- uuid, so a malformed or unexpected object name fails the policy check
-- (property_id = null is never true) rather than erroring the whole query
-- for every other row being evaluated alongside it.
create function storage_extract_property_id(path text) returns uuid
language sql stable set search_path = public as $$
  select case
    when (storage.foldername(path))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((storage.foldername(path))[1])::uuid
    else null
  end;
$$;

grant execute on function storage_extract_property_id(text) to authenticated;

create policy property_logos_select on storage.objects for select to authenticated
  using (bucket_id = 'property-logos' and has_property_access(storage_extract_property_id(name)));

create policy property_logos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'property-logos' and has_permission(storage_extract_property_id(name), 'core.property.manage'));

create policy property_logos_update on storage.objects for update to authenticated
  using (bucket_id = 'property-logos' and has_permission(storage_extract_property_id(name), 'core.property.manage'))
  with check (bucket_id = 'property-logos' and has_permission(storage_extract_property_id(name), 'core.property.manage'));

create policy property_logos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'property-logos' and has_permission(storage_extract_property_id(name), 'core.property.manage'));

commit;

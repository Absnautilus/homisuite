-- A photo for each dining category, shown in the guest app's category
-- tiles instead of (or alongside) the initial-letter fallback. Same
-- Storage idiom as property-logos (20260915130000): objects live at
-- `<hotel_id>/<category_id>.<ext>`, the top-level folder is dining_categories'
-- own hotel_id (the legacy id, same one RLS on dining_categories itself
-- already keys off), and every policy below extracts it from the object
-- path. The bucket is public so the guest app can use the object's public
-- URL directly -- a category photo isn't sensitive.
begin;

alter table dining_categories add column image_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dining-category-photos', 'dining-category-photos', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create function storage_extract_dining_hotel_id(path text) returns uuid
language sql stable set search_path = public as $$
  select case
    when (storage.foldername(path))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((storage.foldername(path))[1])::uuid
    else null
  end;
$$;

grant execute on function storage_extract_dining_hotel_id(text) to authenticated;

create policy dining_category_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'dining-category-photos' and has_property_access(legacy_hotel_property_id(storage_extract_dining_hotel_id(name))));

create policy dining_category_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'dining-category-photos' and has_permission(legacy_hotel_property_id(storage_extract_dining_hotel_id(name)), 'dining.manage'));

create policy dining_category_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'dining-category-photos' and has_permission(legacy_hotel_property_id(storage_extract_dining_hotel_id(name)), 'dining.manage'))
  with check (bucket_id = 'dining-category-photos' and has_permission(legacy_hotel_property_id(storage_extract_dining_hotel_id(name)), 'dining.manage'));

-- Supabase's own protect_delete trigger blocks every direct `delete from
-- storage.objects`, for every role, regardless of this policy -- object
-- deletion only ever happens through the Storage API, which is what
-- actually consults this policy for a remove() call.
create policy dining_category_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'dining-category-photos' and has_permission(legacy_hotel_property_id(storage_extract_dining_hotel_id(name)), 'dining.manage'));

commit;

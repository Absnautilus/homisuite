-- Core property managers configure OHIP without requiring Housekeeping roles.
-- Existing credentials and sync state stay in the legacy table until the worker migration.
begin;
create or replace function public.core_save_pms_integration(
  p_property_id uuid,
  p_mode text,
  p_ohip_hotel_code text,
  p_ohip_enterprise_id text,
  p_ohip_gateway_url text,
  p_ohip_client_id text,
  p_ohip_client_secret text,
  p_ohip_app_key text
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_hotel_id uuid;
  v_gateway text;
begin
  if auth.uid() is null or not public.profile_has_permission(auth.uid(), p_property_id, 'core.property.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select legacy_hotel_id into v_hotel_id from public.legacy_property_mapping
  where platform_property_id = p_property_id;
  if v_hotel_id is null then raise exception 'property not mapped'; end if;
  if p_mode not in ('manual', 'opera') then raise exception 'invalid PMS mode'; end if;
  v_gateway := nullif(btrim(p_ohip_gateway_url), '');
  if p_mode = 'opera' and (
    nullif(btrim(p_ohip_hotel_code), '') is null or v_gateway is null
  ) then raise exception 'OHIP hotel code and gateway required'; end if;
  if v_gateway is not null and v_gateway !~* '^https://[a-z0-9-]+\.hospitality-api\.[a-z0-9-]+\.ocs\.oraclecloud\.com/?$'
  then raise exception 'unsupported OHIP gateway'; end if;
  insert into public.pms_integrations (
    hotel_id, mode, ohip_hotel_code, ohip_enterprise_id, ohip_gateway_url,
    ohip_client_id, ohip_client_secret, ohip_app_key
  ) values (
    v_hotel_id, p_mode::public.stay_source, nullif(btrim(p_ohip_hotel_code), ''),
    nullif(btrim(p_ohip_enterprise_id), ''), v_gateway,
    nullif(btrim(p_ohip_client_id), ''), nullif(btrim(p_ohip_client_secret), ''),
    nullif(btrim(p_ohip_app_key), '')
  )
  on conflict (hotel_id) do update set
    mode = excluded.mode,
    ohip_hotel_code = excluded.ohip_hotel_code,
    ohip_enterprise_id = excluded.ohip_enterprise_id,
    ohip_gateway_url = excluded.ohip_gateway_url,
    ohip_client_id = coalesce(excluded.ohip_client_id, public.pms_integrations.ohip_client_id),
    ohip_client_secret = coalesce(excluded.ohip_client_secret, public.pms_integrations.ohip_client_secret),
    ohip_app_key = coalesce(excluded.ohip_app_key, public.pms_integrations.ohip_app_key);
end;
$$;
revoke all on function public.core_save_pms_integration(uuid,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.core_save_pms_integration(uuid,text,text,text,text,text,text,text) to authenticated;
commit;

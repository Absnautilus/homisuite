-- Core-owned, property-scoped PMS status; secrets never leave the server.
begin;
create or replace function public.core_pms_integration_status(p_property_id uuid)
returns table (
  mode text, ohip_hotel_code text, ohip_enterprise_id text,
  ohip_gateway_url text, has_credentials boolean,
  last_sync_at timestamptz, last_sync_status text, last_sync_error text
)
language sql stable security definer set search_path = ''
as $$
  select coalesce(p.mode::text, 'manual'), p.ohip_hotel_code, p.ohip_enterprise_id,
         p.ohip_gateway_url,
         coalesce(p.ohip_client_id is not null and p.ohip_client_secret is not null, false),
         p.last_sync_at, p.last_sync_status, p.last_sync_error
  from public.legacy_property_mapping lm
  left join public.pms_integrations p on p.hotel_id = lm.legacy_hotel_id
  where lm.platform_property_id = p_property_id
    and auth.uid() is not null
    and (
      public.profile_has_permission(auth.uid(), p_property_id, 'core.property.manage')
      or public.profile_has_permission(auth.uid(), p_property_id, 'core.staff.manage')
    )
  limit 1
$$;
revoke all on function public.core_pms_integration_status(uuid) from public, anon;
grant execute on function public.core_pms_integration_status(uuid) to authenticated;
commit;

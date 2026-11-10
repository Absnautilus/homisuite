-- Moduli (ModulesPage) only ever displayed property_modules.enabled --
-- there was no self-service way to flip it; property_modules carried no
-- RLS write policy at all, so only a Platform Admin path (bypassing RLS)
-- could change it. This RPC lets a property admin do it themselves,
-- gated on the same core.property.manage permission SettingsPage's own
-- "Struttura" section already requires.
create function set_property_module_enabled(p_property_id uuid, p_module_id uuid, p_enabled boolean)
returns void
language plpgsql security invoker set search_path = public as $$
begin
  if not has_permission(p_property_id, 'core.property.manage') then
    raise exception 'insufficient_permission' using errcode = '42501';
  end if;

  insert into property_modules (property_id, module_id, enabled)
  values (p_property_id, p_module_id, p_enabled)
  on conflict (property_id, module_id) do update set enabled = excluded.enabled;
end;
$$;

revoke all on function set_property_module_enabled(uuid, uuid, boolean) from public;
grant execute on function set_property_module_enabled(uuid, uuid, boolean) to authenticated;

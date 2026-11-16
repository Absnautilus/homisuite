-- Lets a Platform Admin change a module's lifecycle stage, and for
-- 'testing' which properties are opted in, directly from the ordinary
-- Moduli page (not the separate /admin console) -- same data these
-- already-seen read-only platform APIs expose, just with a write path.
--
-- Gated on platform_has_permission('platform.modules.manage') AND a
-- verified MFA session, the same two-check pattern every other mutating
-- platform RPC (set_platform_admin_status) already follows.

insert into platform_permissions (slug) values ('platform.modules.manage')
on conflict (slug) do nothing;

-- Bootstrap grant: same manual path every platform_admin_permissions row
-- has ever been created through (no self-service grant RPC exists, by
-- design -- see 20261014150000_platform_admin_identity.sql). Grants it
-- to every CURRENT platform admin, so whoever already administers the
-- platform today gets this capability without a second manual step.
insert into platform_admin_permissions (platform_admin_id, permission_slug)
select pa.id, 'platform.modules.manage' from platform_admins pa
on conflict (platform_admin_id, permission_slug) do nothing;

create function platform_set_module_status(p_module_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not platform_has_permission('platform.modules.manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if not platform_mfa_satisfied() then
    raise exception 'mfa_required' using errcode = '42501';
  end if;
  if p_status not in ('in_development', 'testing', 'beta', 'active', 'deprecated') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  update modules set status = p_status, updated_at = now() where id = p_module_id;
  if not found then
    raise exception 'module_not_found' using errcode = '22023';
  end if;

  perform log_platform_action('platform.module_status_changed', 'module', p_module_id, jsonb_build_object('status', p_status));
end;
$$;
revoke all on function platform_set_module_status(uuid, text) from public, anon;
grant execute on function platform_set_module_status(uuid, text) to authenticated;

create function platform_set_module_testing_access(p_module_id uuid, p_property_id uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not platform_has_permission('platform.modules.manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if not platform_mfa_satisfied() then
    raise exception 'mfa_required' using errcode = '42501';
  end if;

  insert into property_modules (property_id, module_id, testing_access)
  values (p_property_id, p_module_id, p_enabled)
  on conflict (property_id, module_id) do update set testing_access = p_enabled, updated_at = now();

  perform log_platform_action(
    'platform.module_testing_access_changed', 'module', p_module_id,
    jsonb_build_object('property_id', p_property_id, 'enabled', p_enabled)
  );
end;
$$;
revoke all on function platform_set_module_testing_access(uuid, uuid, boolean) from public, anon;
grant execute on function platform_set_module_testing_access(uuid, uuid, boolean) to authenticated;

-- Flat, platform-wide property list (id/name/org name) plus this one
-- module's current testing_access per property -- what the testing-access
-- picker on Moduli needs, without the admin drilling into each
-- organization individually the way the /admin console's own
-- platform_list_properties(organization_id) does.
create function platform_list_module_testing_access(p_module_id uuid) returns table(
  property_id uuid,
  property_name text,
  organization_name text,
  testing_access boolean
)
language plpgsql security definer set search_path = public as $$
begin
  if not platform_has_permission('platform.properties.read') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  return query
    select p.id, p.name, o.name, coalesce(pm.testing_access, false)
    from properties p
    join organizations o on o.id = p.organization_id
    left join property_modules pm on pm.property_id = p.id and pm.module_id = p_module_id
    order by o.name, p.name;
end;
$$;
revoke all on function platform_list_module_testing_access(uuid) from public, anon;
grant execute on function platform_list_module_testing_access(uuid) to authenticated;

-- Registro attività: filter by property, and resolve a readable property
-- name per row -- most entries carry a property one way or another
-- (target_type = 'property' directly, or a property_id tucked into
-- metadata for actions whose real target is something else, like a
-- module's testing-access change or a property-scoped team edit); an
-- organization-level or otherwise property-less action simply has no
-- match and is correctly excluded once a property filter is applied.
create or replace function platform_list_audit_log(p_limit int default 50, p_offset int default 0, p_property_id uuid default null) returns table(
  id uuid,
  actor_profile_id uuid,
  actor_full_name text,
  action text,
  target_type text,
  target_id uuid,
  metadata jsonb,
  created_at timestamptz,
  property_id uuid,
  property_name text
)
language plpgsql security definer set search_path = public as $$
begin
  if not platform_has_permission('platform.audit.read') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if not platform_mfa_satisfied() then
    raise exception 'mfa_required' using errcode = '42501';
  end if;
  if p_limit < 1 or p_limit > 200 then
    raise exception 'invalid_limit' using errcode = '22023';
  end if;

  return query
    select
      l.id, l.actor_profile_id, pr.full_name, l.action, l.target_type, l.target_id, l.metadata, l.created_at,
      resolved_property.id, resolved_property.name
    from platform_audit_log l
    left join profiles pr on pr.id = l.actor_profile_id
    left join lateral (
      select p.id, p.name from properties p
      where p.id = case when l.target_type = 'property' then l.target_id else (l.metadata->>'property_id')::uuid end
    ) resolved_property on true
    where p_property_id is null or resolved_property.id = p_property_id
    order by l.created_at desc
    limit p_limit offset p_offset;
end;
$$;

-- Flat, platform-wide property list for the audit log's and Moduli's own
-- property pickers -- every property across every organization in one
-- call, instead of drilling into platform_list_properties(organization_id)
-- one organization at a time.
create function platform_list_all_properties() returns table(
  id uuid,
  name text,
  organization_name text
)
language plpgsql security definer set search_path = public as $$
begin
  if not platform_has_permission('platform.properties.read') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  return query
    select p.id, p.name, o.name
    from properties p
    join organizations o on o.id = p.organization_id
    order by o.name, p.name;
end;
$$;
revoke all on function platform_list_all_properties() from public, anon;
grant execute on function platform_list_all_properties() to authenticated;

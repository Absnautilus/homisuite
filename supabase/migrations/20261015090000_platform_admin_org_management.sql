-- Platform Admin organization/property/module management (write) — Fase B,
-- PR B4. Was always the planned next step after the read-only MVP (Fase A
-- report §7, "Successivo, non MVP": "Creazione/gestione proprietà e
-- attivazione moduli") -- not a new scope decision.
--
-- Same two-check pattern as every privileged function since PR B1:
-- platform_has_permission(slug) AND platform_mfa_satisfied(), checked
-- inside the function body. Two new slugs because read and write are
-- different facts (same reasoning PR B1 gave for platform_has_permission
-- not folding in platform_mfa_satisfied itself) -- an admin who can list
-- organizations should not automatically be able to create one.
--
-- property_modules write access is notable: docs/permissions.md documents
-- it as "service-role/billing-tooling only" (migration 0013 dropped every
-- authenticated write policy on it). This migration does not touch that
-- policy or grant authenticated anything on the table directly -- it adds
-- a SECURITY DEFINER function, owned like every other helper here, that
-- lets Platform Admin do deliberately and audibly what was previously only
-- possible via an ad hoc service-role script. Module entitlement is
-- exactly the kind of back-office commercial decision Platform Admin
-- exists to handle safely -- this is the intended first non-service-role
-- path to this table, not a bypass of it.
--
-- No existing RLS policy on organizations/properties/property_modules is
-- modified. No existing migration is changed or duplicated.

begin;

insert into platform_permissions (slug) values
  ('platform.organizations.manage'),
  ('platform.properties.manage');

-- ---------------------------------------------------------------------------
-- platform_create_organization(name, slug) — the only way to create an
-- organization is through this function or raw SQL; there is still no
-- RLS insert policy for `authenticated` on `organizations` (unchanged).
-- ---------------------------------------------------------------------------
create function platform_create_organization(p_name text, p_slug text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not platform_has_permission('platform.organizations.manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if not platform_mfa_satisfied() then
    raise exception 'mfa_required' using errcode = '42501';
  end if;
  if length(trim(p_name)) = 0 or length(trim(p_slug)) = 0 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  insert into organizations (name, slug) values (trim(p_name), trim(p_slug))
  returning id into v_id;

  perform log_platform_action('platform.organization_created', 'organization', v_id, jsonb_build_object('name', p_name, 'slug', p_slug));

  return v_id;
end;
$$;

revoke all on function platform_create_organization(text, text) from public, anon;
grant execute on function platform_create_organization(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- platform_update_organization(id, name) — rename only. Slug is immutable
-- here, same convention updateProperty() (packages/core-sdk/src/memberships.ts)
-- already follows for properties -- a slug is a stable identifier other
-- rows/URLs may reference, not a display label.
-- ---------------------------------------------------------------------------
create function platform_update_organization(p_organization_id uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not platform_has_permission('platform.organizations.manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if not platform_mfa_satisfied() then
    raise exception 'mfa_required' using errcode = '42501';
  end if;
  if length(trim(p_name)) = 0 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  update organizations set name = trim(p_name), updated_at = now() where id = p_organization_id;
  if not found then
    raise exception 'organization_not_found' using errcode = '22023';
  end if;

  perform log_platform_action('platform.organization_updated', 'organization', p_organization_id, jsonb_build_object('name', p_name));
end;
$$;

revoke all on function platform_update_organization(uuid, text) from public, anon;
grant execute on function platform_update_organization(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- platform_create_property(organization_id, name, slug, timezone) — mirrors
-- properties' own default ('Europe/Rome', docs/data-model.md) and status
-- ('active', the only sensible default for a newly created property).
-- ---------------------------------------------------------------------------
create function platform_create_property(
  p_organization_id uuid, p_name text, p_slug text, p_timezone text default 'Europe/Rome'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not platform_has_permission('platform.properties.manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if not platform_mfa_satisfied() then
    raise exception 'mfa_required' using errcode = '42501';
  end if;
  if length(trim(p_name)) = 0 or length(trim(p_slug)) = 0 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if not exists (select 1 from organizations where id = p_organization_id) then
    raise exception 'organization_not_found' using errcode = '22023';
  end if;

  insert into properties (organization_id, name, slug, timezone, status)
  values (p_organization_id, trim(p_name), trim(p_slug), coalesce(nullif(trim(p_timezone), ''), 'Europe/Rome'), 'active')
  returning id into v_id;

  perform log_platform_action(
    'platform.property_created', 'property', v_id,
    jsonb_build_object('organization_id', p_organization_id, 'name', p_name, 'slug', p_slug)
  );

  return v_id;
end;
$$;

revoke all on function platform_create_property(uuid, text, text, text) from public, anon;
grant execute on function platform_create_property(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- platform_update_property(id, name, timezone, status) — slug stays
-- immutable, same reasoning as organizations above. status is validated
-- against properties_status_check's own values rather than trusting the
-- DB constraint alone, so a bad value raises this function's own clear
-- error instead of a raw constraint-violation message.
-- ---------------------------------------------------------------------------
create function platform_update_property(
  p_property_id uuid, p_name text, p_timezone text, p_status text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not platform_has_permission('platform.properties.manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if not platform_mfa_satisfied() then
    raise exception 'mfa_required' using errcode = '42501';
  end if;
  if length(trim(p_name)) = 0 or length(trim(p_timezone)) = 0 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_status not in ('active', 'suspended') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  update properties
  set name = trim(p_name), timezone = trim(p_timezone), status = p_status, updated_at = now()
  where id = p_property_id;
  if not found then
    raise exception 'property_not_found' using errcode = '22023';
  end if;

  perform log_platform_action(
    'platform.property_updated', 'property', p_property_id,
    jsonb_build_object('name', p_name, 'timezone', p_timezone, 'status', p_status)
  );
end;
$$;

revoke all on function platform_update_property(uuid, text, text, text) from public, anon;
grant execute on function platform_update_property(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- platform_set_property_module(property_id, module_slug, enabled) — the
-- "attivazione moduli" half of this PR. Upserts property_modules; see this
-- file's header comment for why this is the intended first non-service-role
-- path to this table, not a bypass of its existing lockdown.
-- ---------------------------------------------------------------------------
create function platform_set_property_module(
  p_property_id uuid, p_module_slug text, p_enabled boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_module_id uuid;
begin
  if not platform_has_permission('platform.properties.manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if not platform_mfa_satisfied() then
    raise exception 'mfa_required' using errcode = '42501';
  end if;
  if not exists (select 1 from properties where id = p_property_id) then
    raise exception 'property_not_found' using errcode = '22023';
  end if;

  select id into v_module_id from modules where slug = p_module_slug;
  if v_module_id is null then
    raise exception 'unknown_module' using errcode = '22023';
  end if;

  insert into property_modules (property_id, module_id, enabled)
  values (p_property_id, v_module_id, p_enabled)
  on conflict (property_id, module_id) do update set enabled = excluded.enabled;

  perform log_platform_action(
    'platform.property_module_toggled', 'property', p_property_id,
    jsonb_build_object('module_slug', p_module_slug, 'enabled', p_enabled)
  );
end;
$$;

revoke all on function platform_set_property_module(uuid, text, boolean) from public, anon;
grant execute on function platform_set_property_module(uuid, text, boolean) to authenticated;

commit;

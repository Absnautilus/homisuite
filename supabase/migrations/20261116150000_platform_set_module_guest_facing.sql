-- Lets a Platform Admin toggle whether a module's services show up in the
-- guest-facing app (modules.guest_facing), from the same Moduli page as
-- its lifecycle status -- same permission + MFA gate as
-- platform_set_module_status.
create or replace function public.platform_set_module_guest_facing(p_module_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not platform_has_permission('platform.modules.manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if not platform_mfa_satisfied() then
    raise exception 'mfa_required' using errcode = '42501';
  end if;

  update modules set guest_facing = p_enabled, updated_at = now() where id = p_module_id;
  if not found then
    raise exception 'module_not_found' using errcode = '22023';
  end if;

  perform log_platform_action('platform.module_guest_facing_changed', 'module', p_module_id, jsonb_build_object('guest_facing', p_enabled));
end;
$function$;

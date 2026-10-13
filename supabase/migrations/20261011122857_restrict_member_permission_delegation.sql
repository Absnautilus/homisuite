-- Security hardening already applied to production via Supabase migration
-- restrict_member_permission_delegation (2026-10-11).
-- Keep this migration in version control for future environments.
--
-- Only module-scoped permissions can be delegated, and only to
-- property-scoped memberships. Structural core.* privileges cannot be delegated.
CREATE OR REPLACE FUNCTION public.grant_member_permission(p_membership_id uuid, p_permission_slug text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_membership public.memberships%rowtype;
  v_permission_id uuid;
  v_authorized boolean;
BEGIN
  SELECT * INTO v_membership FROM public.memberships WHERE id = p_membership_id;
  IF v_membership.id IS NULL THEN
    RAISE EXCEPTION 'membership_not_found' USING errcode = '22023';
  END IF;
  v_authorized := CASE
    WHEN v_membership.property_id IS NOT NULL THEN public.has_permission(v_membership.property_id, 'core.staff.manage')
    ELSE public.has_organization_permission(v_membership.organization_id, 'core.staff.manage')
  END;
  IF NOT v_authorized THEN
    RAISE EXCEPTION 'insufficient_privilege' USING errcode = '42501';
  END IF;
  SELECT id INTO v_permission_id FROM public.permissions
  WHERE slug = p_permission_slug AND module_id IS NOT NULL AND slug NOT LIKE 'core.%';
  IF v_permission_id IS NULL THEN
    RAISE EXCEPTION 'permission_not_delegable' USING errcode = '22023';
  END IF;
  IF v_membership.property_id IS NULL THEN
    RAISE EXCEPTION 'property_membership_required' USING errcode = '22023';
  END IF;
  INSERT INTO public.membership_permission_grants (membership_id, permission_id, granted_by)
  VALUES (p_membership_id, v_permission_id, auth.uid())
  ON CONFLICT (membership_id, permission_id) DO NOTHING;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.grant_member_permission(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_member_permission(uuid,text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.member_permission_status(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_permission_status(uuid,text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.revoke_member_permission(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_member_permission(uuid,text) TO authenticated;

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types/database'
import type { CreatePlatformTeamMemberInput, CreatePlatformTeamMemberResult, PlatformAdminStatus, PlatformAuditLogEntry, PlatformOperationalSession, PlatformOperationalSessionRecord, PlatformOperationalSessionStatus, PlatformOrganization, PlatformProperty, PlatformPropertyModule, PlatformTeamMember, ResetPlatformTeamMemberPasswordInput, UpdatePlatformTeamMemberInput } from './types/domain'

// Platform Admin is deliberately its own small module, not folded into
// memberships.ts/permissions.ts -- it never touches a membership, a role,
// or has_permission, and keeping it separate makes that boundary visible
// at the file level too, not just in the database.

export async function getPlatformAdminSelfStatus(client: SupabaseClient<Database>): Promise<PlatformAdminStatus> {
  const { data, error } = await client.rpc('platform_admin_self_status')
  if (error) throw error
  const row = data?.[0]
  return {
    isAdmin: row?.is_admin ?? false,
    status: (row?.status as PlatformAdminStatus['status']) ?? null,
    mfaSatisfied: row?.mfa_satisfied ?? false,
    permissions: row?.permissions ?? [],
  }
}

export async function logPlatformConsoleAccess(client: SupabaseClient<Database>): Promise<void> {
  const { error } = await client.rpc('platform_log_console_access')
  if (error) throw error
}

export async function getPlatformOrganizations(client: SupabaseClient<Database>): Promise<PlatformOrganization[]> {
  const { data, error } = await client.rpc('platform_list_organizations')
  if (error) throw error
  return (data ?? []).map((row) => ({ id: row.id, name: row.name, slug: row.slug, createdAt: row.created_at }))
}

export async function getPlatformProperties(client: SupabaseClient<Database>, organizationId: string): Promise<PlatformProperty[]> {
  const { data, error } = await client.rpc('platform_list_properties', { p_organization_id: organizationId })
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    timezone: row.timezone,
    createdAt: row.created_at,
  }))
}

export async function getPlatformPropertyModules(client: SupabaseClient<Database>, propertyId: string): Promise<PlatformPropertyModule[]> {
  const { data, error } = await client.rpc('platform_list_property_modules', { p_property_id: propertyId })
  if (error) throw error
  return (data ?? []).map((row) => ({ moduleId: row.module_id, slug: row.slug, displayName: row.display_name, enabled: row.enabled }))
}

export async function getPlatformAuditLog(client: SupabaseClient<Database>, limit = 50, offset = 0): Promise<PlatformAuditLogEntry[]> {
  const { data, error } = await client.rpc('platform_list_audit_log', { p_limit: limit, p_offset: offset })
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id,
    actorProfileId: row.actor_profile_id,
    actorFullName: row.actor_full_name,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt: row.created_at,
  }))
}

export async function createPlatformOrganization(client: SupabaseClient<Database>, name: string, slug: string): Promise<string> {
  const { data, error } = await client.rpc('platform_create_organization', { p_name: name, p_slug: slug })
  if (error) throw error
  return data
}

export async function updatePlatformOrganization(client: SupabaseClient<Database>, organizationId: string, name: string): Promise<void> {
  const { error } = await client.rpc('platform_update_organization', { p_organization_id: organizationId, p_name: name })
  if (error) throw error
}

export async function createPlatformProperty(
  client: SupabaseClient<Database>, organizationId: string, name: string, slug: string, timezone?: string,
): Promise<string> {
  const { data, error } = await client.rpc('platform_create_property', {
    p_organization_id: organizationId, p_name: name, p_slug: slug, p_timezone: timezone,
  })
  if (error) throw error
  return data
}

export async function updatePlatformProperty(
  client: SupabaseClient<Database>, propertyId: string, name: string, timezone: string, status: string,
): Promise<void> {
  const { error } = await client.rpc('platform_update_property', {
    p_property_id: propertyId, p_name: name, p_timezone: timezone, p_status: status,
  })
  if (error) throw error
}

export async function setPlatformPropertyModule(
  client: SupabaseClient<Database>, propertyId: string, moduleSlug: string, enabled: boolean,
): Promise<void> {
  const { error } = await client.rpc('platform_set_property_module', {
    p_property_id: propertyId, p_module_slug: moduleSlug, p_enabled: enabled,
  })
  if (error) throw error
}

// Operational context (Fase C) -- opening/closing a session is never a
// privilege request: the standing read right is permanent, a session only
// scopes/audits which single property is "in view" right now. See
// docs/platform-admin-operational-context.md.

export async function openPlatformOperationalSession(
  client: SupabaseClient<Database>, propertyId: string, reason?: string,
): Promise<string> {
  const { data, error } = await client.rpc('platform_open_operational_session', {
    p_property_id: propertyId, p_reason: reason ?? null,
  })
  if (error) throw error
  return data
}

export async function closePlatformOperationalSession(client: SupabaseClient<Database>, sessionId: string): Promise<void> {
  const { error } = await client.rpc('platform_close_operational_session', { p_session_id: sessionId })
  if (error) throw error
}

export async function getMyPlatformOperationalSession(client: SupabaseClient<Database>): Promise<PlatformOperationalSession | null> {
  const { data, error } = await client.rpc('platform_my_operational_session')
  if (error) throw error
  const row = data?.[0]
  if (!row) return null
  return {
    id: row.id,
    propertyId: row.property_id,
    status: row.status as PlatformOperationalSession['status'],
    reason: row.reason,
    openedAt: row.opened_at,
    expiresAt: row.expires_at,
    actingAsMembershipId: row.acting_as_membership_id,
    actingAsFullName: row.acting_as_full_name,
  }
}

// Granular audit + session history (Fase C, PR C4) -- see
// platform_log_operational_view's own doc comment for why this never
// gates the read it accompanies: it only records that an already-
// authorized view happened.

export async function logPlatformOperationalView(
  client: SupabaseClient<Database>, sessionId: string, moduleSlug: string,
): Promise<void> {
  const { error } = await client.rpc('platform_log_operational_view', { p_session_id: sessionId, p_module_slug: moduleSlug })
  if (error) throw error
}

export async function getPlatformOperationalSessions(
  client: SupabaseClient<Database>, limit = 50, offset = 0,
): Promise<PlatformOperationalSessionRecord[]> {
  const { data, error } = await client.rpc('platform_list_operational_sessions', { p_limit: limit, p_offset: offset })
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id,
    platformAdminId: row.platform_admin_id,
    adminFullName: row.admin_full_name,
    propertyId: row.property_id,
    propertyName: row.property_name,
    status: row.status as PlatformOperationalSessionStatus,
    reason: row.reason,
    openedAt: row.opened_at,
    expiresAt: row.expires_at,
    closedAt: row.closed_at,
    closedByFullName: row.closed_by_full_name,
  }))
}

export async function revokePlatformOperationalSession(client: SupabaseClient<Database>, sessionId: string): Promise<void> {
  const { error } = await client.rpc('platform_revoke_operational_session', { p_session_id: sessionId })
  if (error) throw error
}

// Team management (Fase C, PR C5) -- the first write capability past the
// original read-only boundary. Both RPCs are gated on
// platform_operational_action_allowed(property_id, 'platform.team.manage'):
// the standing permission plus an active, unexpired operational session on
// that exact property, same shape as every operational read in this series.

export async function getPlatformPropertyTeam(client: SupabaseClient<Database>, propertyId: string): Promise<PlatformTeamMember[]> {
  const { data, error } = await client.rpc('platform_list_property_team', { p_property_id: propertyId })
  if (error) throw error
  return (data ?? []).map((row) => ({
    membershipId: row.membership_id,
    profileId: row.profile_id,
    fullName: row.full_name,
    roleId: row.role_id,
    roleSlug: row.role_slug,
    roleDisplayName: row.role_display_name,
    status: row.status,
    username: row.username,
    jobTitleId: row.job_title_id,
    jobTitleName: row.job_title_name,
    employmentStatus: row.employment_status as PlatformTeamMember['employmentStatus'],
    createdAt: row.created_at,
  }))
}

// Same "surface the Edge Function's own JSON error body, not the library's
// generic message" need as createTeamMemberWithCredentials (team.ts) --
// duplicated rather than imported, matching this file's own stated
// boundary (platformAdmin.ts never reaches into the ordinary team/
// membership modules, and vice versa).
async function invokePlatformErrorMessage(error: unknown): Promise<Error> {
  const context = (error as { context?: unknown } | null)?.context
  if (context instanceof Response) {
    try {
      const body = await context.clone().json()
      if (body && typeof (body as { error?: unknown }).error === 'string') {
        return new Error((body as { error: string }).error)
      }
    } catch {
      // response body wasn't JSON (or already consumed) -- fall through
    }
  }
  return error instanceof Error ? error : new Error(String(error))
}

export async function createPlatformTeamMember(
  client: SupabaseClient<Database>, input: CreatePlatformTeamMemberInput,
): Promise<CreatePlatformTeamMemberResult> {
  const { data, error } = await client.functions.invoke('platform-create-team-member', { body: input })
  if (error) throw await invokePlatformErrorMessage(error)
  return data as CreatePlatformTeamMemberResult
}

// "Visualizza come" with real writes (Fase C follow-up, Part 2). Opening
// this session is a strictly more sensitive action than a plain
// operational session -- platform.impersonation.write, never
// platform.support.read alone -- and the acting-as person is fixed for the
// session's whole lifetime, never swapped mid-session.

export async function openPlatformImpersonationSession(
  client: SupabaseClient<Database>, propertyId: string, actingAsMembershipId: string, reason?: string,
): Promise<string> {
  const { data, error } = await client.rpc('platform_open_impersonation_session', {
    p_property_id: propertyId, p_acting_as_membership_id: actingAsMembershipId, p_reason: reason ?? null,
  })
  if (error) throw error
  return data
}

// The one write this PR adds: Housekeeping's in_progress->completed
// transition, executed with the acting-as person's functional authority but
// always attributed to Admin Master herself in platform_audit_log -- see
// platform_impersonated_complete_guest_request's own doc comment.
export async function completeGuestRequestAsPlatformImpersonation(
  client: SupabaseClient<Database>, guestRequestId: string, actingAsMembershipId: string,
): Promise<void> {
  const { error } = await client.rpc('platform_impersonated_complete_guest_request', {
    p_guest_request_id: guestRequestId, p_acting_as_membership_id: actingAsMembershipId,
  })
  if (error) throw error
}

// Team management edit/archive/reset-password (Fase C, PR C6) -- parity
// with the ordinary Team page's own updateTeamMember/archiveTeamMember/
// resetTeamMemberPassword, reached through platform_operational_action_
// allowed(property_id, 'platform.team.manage') instead of core.staff.manage.

export async function updatePlatformTeamMember(client: SupabaseClient<Database>, input: UpdatePlatformTeamMemberInput): Promise<void> {
  const { error } = await client.rpc('platform_update_team_membership', {
    p_membership_id: input.membershipId,
    p_role_id: input.roleId ?? null,
    p_job_title_id: input.jobTitleId ?? null,
    p_employment_status: input.employmentStatus ?? null,
    p_membership_status: input.membershipStatus ?? null,
  })
  if (error) throw error
}

export async function archivePlatformTeamMember(client: SupabaseClient<Database>, membershipId: string): Promise<void> {
  const { error } = await client.rpc('platform_archive_team_member', { p_membership_id: membershipId })
  if (error) throw error
}

export async function resetPlatformTeamMemberPassword(
  client: SupabaseClient<Database>, input: ResetPlatformTeamMemberPasswordInput,
): Promise<void> {
  const { error } = await client.functions.invoke('platform-reset-team-member-password', { body: input })
  if (error) throw await invokePlatformErrorMessage(error)
}

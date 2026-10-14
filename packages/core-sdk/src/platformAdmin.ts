import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types/database'
import type { PlatformAdminStatus, PlatformAuditLogEntry, PlatformOrganization, PlatformProperty, PlatformPropertyModule } from './types/domain'

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

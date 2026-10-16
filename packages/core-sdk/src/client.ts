import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types/database'
import type { ArchiveTeamMemberInput, CoreRole, CreatePlatformTeamMemberInput, CreatePlatformTeamMemberResult, CreateTeamMemberWithCredentialsInput, CreateTeamMemberWithCredentialsResult, GrantHousekeepingAccessInput, InviteTeamMemberInput, JobTitle, MemberPermissionStatus, Membership, ModuleEntitlement, PlatformAdminStatus, PlatformAuditLogEntry, PlatformOperationalSession, PlatformOperationalSessionRecord, PlatformOrganization, PlatformProperty, PlatformPropertyModule, PlatformTeamMember, Profile, Property, ResetTeamMemberPasswordInput, RevokeHousekeepingAccessInput, TeamMember, UpdateTeamMemberInput } from './types/domain'
import { getCurrentProfile, updateCurrentProfile } from './profile'
import { deleteDevicePushSubscription, isDevicePushSubscribed, saveDevicePushSubscription, type DevicePushSubscriptionKeys } from './devicePush'
import { getAccessibleProperties, getMembership, updateProperty } from './memberships'
import { hasPermission } from './permissions'
import { getEnabledModules } from './modules'
import { getGuestRequestsLegacyHotelId, getGuestRequestsSlugForProperty } from './guestRequests'
import { getDiningLegacyHotelId } from './dining'
import { archiveTeamMember, createJobTitle, createTeamMemberWithCredentials, getHousekeepingAccessStatus, getJobTitles, getMemberModuleAccessStatus, getMemberPermissionStatus, getPropertyRoles, getTeamMembers, grantHousekeepingAccess, grantMemberPermission, inviteTeamMember, resetTeamMemberPassword, revokeHousekeepingAccess, revokeMemberPermission, setMemberModuleAccess, updateJobTitle, updateTeamMember } from './team'
import { closePlatformOperationalSession, completeGuestRequestAsPlatformImpersonation, createPlatformOrganization, createPlatformProperty, createPlatformTeamMember, getMyPlatformOperationalSession, getPlatformAdminSelfStatus, getPlatformAuditLog, getPlatformOperationalSessions, getPlatformOrganizations, getPlatformProperties, getPlatformPropertyModules, getPlatformPropertyTeam, logPlatformConsoleAccess, logPlatformOperationalView, openPlatformImpersonationSession, openPlatformOperationalSession, revokePlatformOperationalSession, setPlatformPropertyModule, updatePlatformOrganization, updatePlatformProperty } from './platformAdmin'

export interface CoreClient {
  // Escape hatch for a module that needs the raw Supabase client (e.g. to
  // query its own tables) — the Core SDK deliberately doesn't wrap or proxy
  // module data, only identity/tenant/permission/entitlement concerns.
  raw: SupabaseClient<Database>
  getCurrentProfile: () => Promise<Profile | null>
  getAccessibleProperties: () => Promise<Property[]>
  getMembership: (propertyId: string) => Promise<Membership | null>
  hasPermission: (propertyId: string, permissionSlug: string) => Promise<boolean>
  getEnabledModules: (propertyId: string) => Promise<ModuleEntitlement[]>
  getGuestRequestsLegacyHotelId: (propertyId: string) => Promise<string | null>
  getGuestRequestsSlugForProperty: (propertyId: string) => Promise<string | null>
  getDiningLegacyHotelId: (propertyId: string) => Promise<string | null>
  getTeamMembers: (propertyId: string) => Promise<TeamMember[]>
  getPropertyRoles: () => Promise<CoreRole[]>
  getJobTitles: (propertyId: string) => Promise<JobTitle[]>
  createJobTitle: (propertyId: string, name: string) => Promise<JobTitle>
  updateJobTitle: (id: string, changes: { name?: string; active?: boolean }) => Promise<void>
  inviteTeamMember: (input: InviteTeamMemberInput) => Promise<void>
  createTeamMemberWithCredentials: (input: CreateTeamMemberWithCredentialsInput) => Promise<CreateTeamMemberWithCredentialsResult>
  resetTeamMemberPassword: (input: ResetTeamMemberPasswordInput) => Promise<void>
  grantHousekeepingAccess: (input: GrantHousekeepingAccessInput) => Promise<void>
  revokeHousekeepingAccess: (input: RevokeHousekeepingAccessInput) => Promise<void>
  getHousekeepingAccessStatus: (membershipId: string) => Promise<boolean>
  getMemberPermissionStatus: (membershipId: string, permissionSlug: string) => Promise<MemberPermissionStatus>
  grantMemberPermission: (membershipId: string, permissionSlug: string) => Promise<void>
  revokeMemberPermission: (membershipId: string, permissionSlug: string) => Promise<void>
  getMemberModuleAccessStatus: (membershipId: string, moduleSlug: string) => Promise<boolean>
  setMemberModuleAccess: (membershipId: string, moduleSlug: string, enabled: boolean) => Promise<void>
  updateTeamMember: (input: UpdateTeamMemberInput) => Promise<void>
  archiveTeamMember: (input: ArchiveTeamMemberInput) => Promise<void>
  updateCurrentProfile: (changes: { fullName: string; avatarUrl?: string | null }) => Promise<Profile>
  updateProperty: (propertyId: string, changes: { name: string; timezone: string; settings?: Record<string, unknown> }) => Promise<Property>
  saveDevicePushSubscription: (keys: DevicePushSubscriptionKeys) => Promise<void>
  deleteDevicePushSubscription: (endpoint: string) => Promise<void>
  isDevicePushSubscribed: (endpoint: string) => Promise<boolean>
  getPlatformAdminSelfStatus: () => Promise<PlatformAdminStatus>
  logPlatformConsoleAccess: () => Promise<void>
  getPlatformOrganizations: () => Promise<PlatformOrganization[]>
  getPlatformProperties: (organizationId: string) => Promise<PlatformProperty[]>
  getPlatformPropertyModules: (propertyId: string) => Promise<PlatformPropertyModule[]>
  getPlatformAuditLog: (limit?: number, offset?: number) => Promise<PlatformAuditLogEntry[]>
  createPlatformOrganization: (name: string, slug: string) => Promise<string>
  updatePlatformOrganization: (organizationId: string, name: string) => Promise<void>
  createPlatformProperty: (organizationId: string, name: string, slug: string, timezone?: string) => Promise<string>
  updatePlatformProperty: (propertyId: string, name: string, timezone: string, status: string) => Promise<void>
  setPlatformPropertyModule: (propertyId: string, moduleSlug: string, enabled: boolean) => Promise<void>
  openPlatformOperationalSession: (propertyId: string, reason?: string) => Promise<string>
  closePlatformOperationalSession: (sessionId: string) => Promise<void>
  getMyPlatformOperationalSession: () => Promise<PlatformOperationalSession | null>
  logPlatformOperationalView: (sessionId: string, moduleSlug: string) => Promise<void>
  getPlatformOperationalSessions: (limit?: number, offset?: number) => Promise<PlatformOperationalSessionRecord[]>
  revokePlatformOperationalSession: (sessionId: string) => Promise<void>
  getPlatformPropertyTeam: (propertyId: string) => Promise<PlatformTeamMember[]>
  createPlatformTeamMember: (input: CreatePlatformTeamMemberInput) => Promise<CreatePlatformTeamMemberResult>
  openPlatformImpersonationSession: (propertyId: string, actingAsMembershipId: string, reason?: string) => Promise<string>
  completeGuestRequestAsPlatformImpersonation: (guestRequestId: string, actingAsMembershipId: string) => Promise<void>
}

export function createCoreClient(supabaseUrl: string, supabaseAnonKey: string): CoreClient {
  const raw = createClient<Database>(supabaseUrl, supabaseAnonKey)
  return {
    raw,
    getCurrentProfile: () => getCurrentProfile(raw),
    getAccessibleProperties: () => getAccessibleProperties(raw),
    getMembership: (propertyId) => getMembership(raw, propertyId),
    hasPermission: (propertyId, permissionSlug) => hasPermission(raw, propertyId, permissionSlug),
    getEnabledModules: (propertyId) => getEnabledModules(raw, propertyId),
    getGuestRequestsLegacyHotelId: (propertyId) => getGuestRequestsLegacyHotelId(raw, propertyId),
    getGuestRequestsSlugForProperty: (propertyId) => getGuestRequestsSlugForProperty(raw, propertyId),
    getDiningLegacyHotelId: (propertyId) => getDiningLegacyHotelId(raw, propertyId),
    getTeamMembers: (propertyId) => getTeamMembers(raw, propertyId),
    getPropertyRoles: () => getPropertyRoles(raw),
    getJobTitles: (propertyId) => getJobTitles(raw, propertyId),
    createJobTitle: (propertyId, name) => createJobTitle(raw, propertyId, name),
    updateJobTitle: (id, changes) => updateJobTitle(raw, id, changes),
    inviteTeamMember: (input) => inviteTeamMember(raw, input),
    createTeamMemberWithCredentials: (input) => createTeamMemberWithCredentials(raw, input),
    resetTeamMemberPassword: (input) => resetTeamMemberPassword(raw, input),
    grantHousekeepingAccess: (input) => grantHousekeepingAccess(raw, input),
    revokeHousekeepingAccess: (input) => revokeHousekeepingAccess(raw, input),
    getHousekeepingAccessStatus: (membershipId) => getHousekeepingAccessStatus(raw, membershipId),
    getMemberPermissionStatus: (membershipId, permissionSlug) => getMemberPermissionStatus(raw, membershipId, permissionSlug),
    grantMemberPermission: (membershipId, permissionSlug) => grantMemberPermission(raw, membershipId, permissionSlug),
    revokeMemberPermission: (membershipId, permissionSlug) => revokeMemberPermission(raw, membershipId, permissionSlug),
    getMemberModuleAccessStatus: (membershipId, moduleSlug) => getMemberModuleAccessStatus(raw, membershipId, moduleSlug),
    setMemberModuleAccess: (membershipId, moduleSlug, enabled) => setMemberModuleAccess(raw, membershipId, moduleSlug, enabled),
    updateTeamMember: (input) => updateTeamMember(raw, input),
    archiveTeamMember: (input) => archiveTeamMember(raw, input),
    updateCurrentProfile: (changes) => updateCurrentProfile(raw, changes),
    updateProperty: (propertyId, changes) => updateProperty(raw, propertyId, changes),
    saveDevicePushSubscription: (keys) => saveDevicePushSubscription(raw, keys),
    deleteDevicePushSubscription: (endpoint) => deleteDevicePushSubscription(raw, endpoint),
    isDevicePushSubscribed: (endpoint) => isDevicePushSubscribed(raw, endpoint),
    getPlatformAdminSelfStatus: () => getPlatformAdminSelfStatus(raw),
    logPlatformConsoleAccess: () => logPlatformConsoleAccess(raw),
    getPlatformOrganizations: () => getPlatformOrganizations(raw),
    getPlatformProperties: (organizationId) => getPlatformProperties(raw, organizationId),
    getPlatformPropertyModules: (propertyId) => getPlatformPropertyModules(raw, propertyId),
    getPlatformAuditLog: (limit, offset) => getPlatformAuditLog(raw, limit, offset),
    createPlatformOrganization: (name, slug) => createPlatformOrganization(raw, name, slug),
    updatePlatformOrganization: (organizationId, name) => updatePlatformOrganization(raw, organizationId, name),
    createPlatformProperty: (organizationId, name, slug, timezone) => createPlatformProperty(raw, organizationId, name, slug, timezone),
    updatePlatformProperty: (propertyId, name, timezone, status) => updatePlatformProperty(raw, propertyId, name, timezone, status),
    setPlatformPropertyModule: (propertyId, moduleSlug, enabled) => setPlatformPropertyModule(raw, propertyId, moduleSlug, enabled),
    openPlatformOperationalSession: (propertyId, reason) => openPlatformOperationalSession(raw, propertyId, reason),
    closePlatformOperationalSession: (sessionId) => closePlatformOperationalSession(raw, sessionId),
    getMyPlatformOperationalSession: () => getMyPlatformOperationalSession(raw),
    logPlatformOperationalView: (sessionId, moduleSlug) => logPlatformOperationalView(raw, sessionId, moduleSlug),
    getPlatformOperationalSessions: (limit, offset) => getPlatformOperationalSessions(raw, limit, offset),
    revokePlatformOperationalSession: (sessionId) => revokePlatformOperationalSession(raw, sessionId),
    getPlatformPropertyTeam: (propertyId) => getPlatformPropertyTeam(raw, propertyId),
    createPlatformTeamMember: (input) => createPlatformTeamMember(raw, input),
    openPlatformImpersonationSession: (propertyId, actingAsMembershipId, reason) =>
      openPlatformImpersonationSession(raw, propertyId, actingAsMembershipId, reason),
    completeGuestRequestAsPlatformImpersonation: (guestRequestId, actingAsMembershipId) =>
      completeGuestRequestAsPlatformImpersonation(raw, guestRequestId, actingAsMembershipId),
  }
}

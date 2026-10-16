// Application-facing types. Everything the SDK returns is one of these, never
// a raw Database['public']['Tables'][...]['Row'] — see database.ts's header
// for why. Field names are camelCase here on purpose, to make "this is a
// mapped domain type, not a DB row" visible at a glance.

export type MembershipStatus = 'invited' | 'active' | 'suspended'
export type PropertyStatus = 'active' | 'suspended'
export type ModuleStatus = 'active' | 'beta' | 'deprecated'
export type RoleScope = 'organization' | 'property'

export interface Organization {
  id: string
  name: string
  slug: string
}

export interface Property {
  id: string
  organizationId: string
  name: string
  slug: string
  timezone: string
  status: PropertyStatus
  settings: Record<string, unknown>
}

export interface Profile {
  id: string
  fullName: string
  avatarUrl: string | null
}

export interface CoreRole {
  id: string
  slug: string
  displayName: string
  scope: RoleScope
  rank: number
}

export interface JobTitle {
  id: string
  propertyId: string
  name: string
  active: boolean
}

export type EmploymentStatus = 'active' | 'inactive'

// Independent of the free-text job title above: which of Housekeeping's
// own departments this person's guest_requests queue is scoped to once
// Housekeeping access is granted. null means "not set" -- Housekeeping
// falls back to its own legacy default for that case (see
// current_staff_department()'s own comment). Deliberately excludes
// Housekeeping's 'porter' department value, which only ever applies to
// request categories, never to a staff member themselves.
export type HousekeepingDepartment = 'reception' | 'housekeeping' | 'maintenance'

export interface TeamMember {
  profile: Profile
  membership: Membership
  role: CoreRole
  jobTitle: JobTitle | null
  employmentStatus: EmploymentStatus
  housekeepingDepartment: HousekeepingDepartment | null
}

export interface InviteTeamMemberInput {
  propertyId: string
  fullName: string
  email: string
  roleId: string
  jobTitleId?: string | null
}

// The credentials alternative to InviteTeamMemberInput -- no email, no
// invite mail sent. username is scoped unique per property (see
// memberships_property_username_unique); the account's real auth.users
// email is a synthetic, globally-unique value the Edge Function derives
// from username + property + organization, invisible to both the admin
// and the staff member (who log in with plain username + password).
export interface CreateTeamMemberWithCredentialsInput {
  propertyId: string
  fullName: string
  username: string
  password: string
  roleId: string
  jobTitleId?: string | null
}

// loginIdentifier is the synthesized auth.users email -- opaque to the
// caller, shown once so the admin can hand it to the new team member
// alongside the password they just chose (same "shown once" pattern as a
// guest stay's PIN).
export interface CreateTeamMemberWithCredentialsResult {
  profileId: string
  membershipId: string
  loginIdentifier: string
}

export interface ResetTeamMemberPasswordInput {
  membershipId: string
  newPassword: string
}

export interface GrantHousekeepingAccessInput {
  membershipId: string
}

export interface RevokeHousekeepingAccessInput {
  membershipId: string
}

export interface MemberPermissionStatus {
  grantedByRole: boolean
  grantedByOverride: boolean
}

export interface ArchiveTeamMemberInput {
  membershipId: string
}

export interface UpdateTeamMemberInput {
  membershipId: string
  profileId: string
  propertyId: string
  roleId?: string
  membershipStatus?: MembershipStatus
  jobTitleId?: string | null
  employmentStatus?: EmploymentStatus
  housekeepingDepartment?: HousekeepingDepartment | null
}

export interface Membership {
  id: string
  profileId: string
  // Exactly one of these two is set — mirrors the database's own
  // memberships_exactly_one_scope check. propertyId set = a single-property
  // grant; organizationId set = an org-wide grant covering every property
  // under it.
  propertyId: string | null
  organizationId: string | null
  roleId: string
  status: MembershipStatus
  // Set only for a credentials-based (no email) account -- null for every
  // membership created via the email-invite flow.
  username: string | null
}

// Deliberately a plain string, not a union of literal slugs: a new module
// shouldn't require a Core SDK release to be recognized. The `modules`
// table is the source of truth for which slugs exist — see
// docs/module-integration.md (Step 5).
export type ModuleSlug = string

export interface ModuleEntitlement {
  moduleId: string
  slug: ModuleSlug
  displayName: string
  enabled: boolean
}

// What a module declares about itself. A compile-time contract only — see
// src/moduleContract.ts. The `modules` table row is the actual runtime
// registration; this type has no connection to it beyond convention.
export interface ModuleDescriptor {
  slug: ModuleSlug
  displayName: string
  requiredPermissions: string[]
}

// Platform Admin -- a global Homisuite-staff identity, structurally
// separate from memberships/roles/permissions. See
// docs/platform-admin-architecture.md. Never derived from, or compared
// against, any tenant role.
export interface PlatformAdminStatus {
  isAdmin: boolean
  status: 'active' | 'suspended' | null
  mfaSatisfied: boolean
  permissions: string[]
}

export interface PlatformOrganization {
  id: string
  name: string
  slug: string
  createdAt: string
}

export interface PlatformProperty {
  id: string
  organizationId: string
  name: string
  slug: string
  status: string
  timezone: string
  createdAt: string
}

export interface PlatformPropertyModule {
  moduleId: string
  slug: ModuleSlug
  displayName: string
  enabled: boolean
}

// A session is scoping/audit/safety on top of the admin's already-standing
// read authorization -- never the authorization itself. See
// docs/platform-admin-operational-context.md.
export type PlatformOperationalSessionStatus = 'active' | 'closed' | 'expired' | 'revoked'

export interface PlatformOperationalSession {
  id: string
  propertyId: string
  status: PlatformOperationalSessionStatus
  reason: string | null
  openedAt: string
  expiresAt: string
  // Set only for a "visualizza come" session (Fase C follow-up, Part 2) --
  // null for a plain operational (read-only) session. Writes performed
  // under such a session execute with THIS person's functional authority,
  // but are always attributed to Admin Master herself in the audit log --
  // never indistinguishable from actingAsFullName's own action.
  actingAsMembershipId: string | null
  actingAsFullName: string | null
}

export interface PlatformAuditLogEntry {
  id: string
  actorProfileId: string | null
  actorFullName: string | null
  action: string
  targetType: string | null
  targetId: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

// The console's session-history view (Fase C, PR C4) -- across every
// admin, not just the caller's own; see platform_list_operational_sessions's
// own doc comment for why this is gated on platform.audit.read rather than
// platform.support.read.
export interface PlatformOperationalSessionRecord {
  id: string
  platformAdminId: string
  adminFullName: string | null
  propertyId: string
  propertyName: string | null
  status: PlatformOperationalSessionStatus
  reason: string | null
  openedAt: string
  expiresAt: string
  closedAt: string | null
  closedByFullName: string | null
}

// Platform Admin team management (Fase C, PR C5) -- the first write
// capability past the original read-only boundary. Gated on
// platform.team.manage + an active operational session, same four-fact
// shape as every operational read, generalized by
// platform_operational_action_allowed() to an arbitrary permission slug.
export interface PlatformTeamMember {
  membershipId: string
  profileId: string
  fullName: string | null
  roleId: string
  roleSlug: string
  roleDisplayName: string
  status: string
  username: string | null
  jobTitleId: string | null
  jobTitleName: string | null
  employmentStatus: EmploymentStatus
  createdAt: string
}

// No email mode -- Admin Master's console always uses the
// username+password path, same reasoning create-team-member-credentials
// already gives for the ordinary Team page's "Credenziali" tab.
export interface CreatePlatformTeamMemberInput {
  propertyId: string
  fullName: string
  username: string
  password: string
  roleId: string
  jobTitleId?: string | null
}

export interface CreatePlatformTeamMemberResult {
  profileId: string
  membershipId: string
  loginIdentifier: string
}

// Edit/archive/reset-password parity with the ordinary Team page's own
// updateTeamMember/archiveTeamMember/resetTeamMemberPassword (Fase C, PR
// C6) -- each field independently optional, so the console only sends what
// actually changed. No fullName here: the ordinary flow never lets an
// admin edit it either, it belongs to the person's own profile.
export interface UpdatePlatformTeamMemberInput {
  membershipId: string
  roleId?: string | null
  jobTitleId?: string | null
  employmentStatus?: EmploymentStatus | null
  membershipStatus?: 'active' | 'suspended' | null
}

export interface ResetPlatformTeamMemberPasswordInput {
  membershipId: string
  newPassword: string
}

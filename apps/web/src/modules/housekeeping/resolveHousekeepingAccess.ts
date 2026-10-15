// Isolated on purpose: zero imports, so this stays testable under plain Node
// without pulling in ModuleRuntimeContext or core/client.ts (which throws at
// module-evaluation time when VITE_SUPABASE_URL/ANON_KEY aren't set). It
// carries the actual visibility rule for Housekeeping in nav/Home and for
// the deep-link message: entitlement, a bridged legacy hotel, and an
// operational profile at that hotel are each necessary and individually
// distinguishable, so a user always gets an explicit reason rather than a
// generic dead end.
export type HousekeepingAccessState =
  | { status: 'not-entitled' }
  | { status: 'no-mapping' }
  | { status: 'no-profile' }
  | { status: 'compatible'; hotelId: string }

export function resolveHousekeepingAccess(input: {
  entitled: boolean
  legacyHotelId: string | null
  hasCompatibleProfile: boolean
  // Admin Master's operational view (Fase C): never has, and must never be
  // given, a staff_profiles row -- her read access is already authorized
  // server-side (platform_operational_read_allowed(), PR C2), entirely
  // independent of this legacy per-hotel staff concept. Without this flag
  // she would hit the same 'no-profile' dead end real, not-yet-onboarded
  // tenant staff correctly hit -- a real state for them, a wrong one for her.
  operationalReadOnly?: boolean
}): HousekeepingAccessState {
  if (!input.entitled) return { status: 'not-entitled' }
  if (!input.legacyHotelId) return { status: 'no-mapping' }
  if (!input.hasCompatibleProfile && !input.operationalReadOnly) return { status: 'no-profile' }
  return { status: 'compatible', hotelId: input.legacyHotelId }
}

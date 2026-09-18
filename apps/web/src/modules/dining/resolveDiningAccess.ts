// Isolated on purpose, same shape as Housekeeping's resolveHousekeepingAccess:
// zero imports, so this stays testable under plain Node. Dining is entitled
// per-property (property_modules) but the legacy hotel_id-scoped tables
// underneath still gate access per staff_profiles row at a specific hotel --
// entitlement, a bridged legacy hotel, and an operational profile at that
// hotel are each necessary and individually distinguishable, so a user
// always gets an explicit reason rather than a generic dead end.
export type DiningAccessState =
  | { status: 'not-entitled' }
  | { status: 'no-mapping' }
  | { status: 'no-profile' }
  | { status: 'compatible'; hotelId: string; staffProfileId: string }

export function resolveDiningAccess(input: {
  entitled: boolean
  legacyHotelId: string | null
  staffProfileId: string | null
}): DiningAccessState {
  if (!input.entitled) return { status: 'not-entitled' }
  if (!input.legacyHotelId) return { status: 'no-mapping' }
  if (!input.staffProfileId) return { status: 'no-profile' }
  return { status: 'compatible', hotelId: input.legacyHotelId, staffProfileId: input.staffProfileId }
}

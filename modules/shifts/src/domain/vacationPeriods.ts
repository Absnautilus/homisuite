// "Piano Ferie" domain logic: pure functions mirroring what the backend RPCs
// (request_vacation_period, decide_vacation_period) enforce server-side, so
// the UI can show the same validation immediately instead of waiting on a
// round trip -- the server call is still the final authority, this is only
// for instant feedback and for computing what to render.

export interface VacationPeriod {
  id?: string
  staffProfileId: string
  periodIndex: number
  start: string
  end: string
  status: 'pending' | 'confirmed'
}

export interface VacationSettings {
  periodsPerYear: number
  minDays: number
  maxDays: number
}

export type VacationDisplayStatus = 'taken' | 'confirmed' | 'pending' | 'missing'

/** Inclusive day count between two ISO dates ('YYYY-MM-DD'). */
export function countVacationDays(start: string, end: string): number {
  const startMs = Date.parse(`${start}T00:00:00Z`)
  const endMs = Date.parse(`${end}T00:00:00Z`)
  return Math.round((endMs - startMs) / 86_400_000) + 1
}

function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd
}

/**
 * The first OTHER person's pending/confirmed period that overlaps the given
 * range, or null. Mirrors request_vacation_period's own overlap check
 * (property-wide, excluding the requester's own periods).
 */
export function findVacationOverlap(
  periods: VacationPeriod[],
  excludeStaffProfileId: string,
  start: string,
  end: string,
): VacationPeriod | null {
  for (const period of periods) {
    if (period.staffProfileId === excludeStaffProfileId) continue
    if (rangesOverlap(start, end, period.start, period.end)) return period
  }
  return null
}

export type VacationRequestError =
  | 'invalid_date_range'
  | 'invalid_period_index'
  | 'duration_out_of_range'

/**
 * Validates a candidate request against the property's settings, matching
 * request_vacation_period's own checks (period index bounds, date order,
 * day count bounds) -- overlap is checked separately via
 * findVacationOverlap, since it needs the full roster, not just settings.
 */
export function validateVacationRequest(
  input: { start: string; end: string; periodIndex: number },
  settings: VacationSettings,
): VacationRequestError | null {
  if (input.end < input.start) return 'invalid_date_range'
  if (input.periodIndex < 0 || input.periodIndex >= settings.periodsPerYear) return 'invalid_period_index'
  const days = countVacationDays(input.start, input.end)
  if (days < settings.minDays || days > settings.maxDays) return 'duration_out_of_range'
  return null
}

/**
 * How to display a stored period: a confirmed period whose end date has
 * already passed reads as "taken" rather than "confirmed" -- this status is
 * never stored, only derived at render time against the current date.
 */
export function displayVacationStatus(period: VacationPeriod, todayISO: string): VacationDisplayStatus {
  if (period.status === 'confirmed' && period.end < todayISO) return 'taken'
  return period.status
}

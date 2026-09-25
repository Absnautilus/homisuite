// Ported from Absnautilus/plannerturni's src/domain/restRotation.js, the
// tested rest-day rotation engine the rest of this module's rule system was
// already modeled on. Field names are adapted to homisuite's schema and the
// weekday convention is 0=Sunday (matching fixed_rest_days / Date.getUTCDay,
// not the original app's own 0=Monday) -- the epoch below is anchored one
// day earlier than the original's to realign, so every mod-7 computation
// stays byte-for-byte the same, just relabeled.
//
// Confirmed production rule, carried over verbatim: a rotating employee
// rests in consecutive pairs of 2 days a week. After `pairsPerCycle`
// consecutive pairs, the next rest turn is a SINGLE day (not a pair) and the
// weekday of rest shifts back by 1, to rotate the pattern -- then pairs
// resume on the new weekday. Pairs are generated in one continuous sequence
// (never as a pure function of the day alone) so they always stay exactly 7
// days apart, with no dependency on where month boundaries fall.

export interface RestRotationProfile {
  id: string
  shiftType: 'day' | 'night' | 'rotating' | 'director' | 'fom' | 'custom'
  restMode: 'fixed' | 'rotating'
  fixedRestDays: number[]
  rotationSlot: number | null
}

const EPOCH_SUNDAY_UTC = Date.UTC(2020, 0, 5) // Sunday 5 Jan 2020: weekday 0 by construction
const MS_PER_DAY = 86_400_000
export const DEFAULT_PAIRS_PER_CYCLE = 3

function daysSinceEpoch(year: number, month: number, day: number): number {
  return Math.round((Date.UTC(year, month, day) - EPOCH_SUNDAY_UTC) / MS_PER_DAY)
}

// Walking forward from the epoch, generates rest events (a [start, end] pair
// of epoch-day numbers, or a single [day]) for a given starting weekday,
// until past `throughEpochDay`. Every event starts exactly 7 days after the
// previous one's start (keeping 5 working days between rest turns); every
// (pairsPerCycle + 1)-th event is a single day, on the SAME weekday as the
// pairs before it (not the new one -- otherwise the 5-working-day cadence
// breaks and an anomalous work streak appears). The weekday shifts back by 1
// only in the gap toward the next block, which is therefore 6 days instead
// of 7 -- that missing day is exactly what rotates the weekly pattern back.
function generateRestEvents(startWeekday: number, throughEpochDay: number, pairsPerCycle: number): number[][] {
  const events: number[][] = []
  let weekday = ((startWeekday % 7) + 7) % 7
  let start = weekday
  let pairsSoFar = 0
  while (start <= throughEpochDay) {
    if (pairsSoFar < pairsPerCycle) {
      events.push([start, start + 1])
      pairsSoFar += 1
      start += 7
    } else {
      events.push([start])
      weekday = ((weekday - 1) % 7 + 7) % 7
      start += 6
      pairsSoFar = 0
    }
  }
  return events
}

function isRotatingRestDay(startWeekday: number, year: number, month: number, day: number, pairsPerCycle: number): boolean {
  const epochDay = daysSinceEpoch(year, month, day)
  const events = generateRestEvents(startWeekday, epochDay + 1, pairsPerCycle)
  return events.some((event) => event.includes(epochDay))
}

// The smallest non-negative integer not already used as another rotating
// employee's slot. Assigned once per employee and persisted forever after --
// recomputing it from array position on every run would reshuffle everyone
// else's rest days each time staff are added, removed or reordered.
export function nextFreeRotationSlot(profiles: Array<{ rotationSlot: number | null }>): number {
  const used = new Set(profiles.filter((profile) => profile.rotationSlot != null).map((profile) => profile.rotationSlot as number))
  let slot = 0
  while (used.has(slot)) slot += 1
  return slot
}

/**
 * For one calendar day (month is 0-indexed, matching Date.UTC), whether each
 * profile is resting. `turnanteFollowsNotturno` mirrors the
 * "riposoTurnanteDopoNotturno" hard rule: the rotating-shift employee rests 2
 * weekdays after the night-shift one, when both are on rotating rest --
 * same cycle, offset start.
 */
export function isRestDay(
  profiles: RestRotationProfile[],
  year: number,
  month: number,
  day: number,
  turnanteFollowsNotturno: boolean,
  pairsPerCycle: number = DEFAULT_PAIRS_PER_CYCLE,
): Record<string, boolean> {
  const startWeekdayById: Record<string, number> = {}
  for (const profile of profiles) {
    if (profile.restMode !== 'fixed') {
      startWeekdayById[profile.id] = ((profile.rotationSlot ?? 0) * 2) % 7
    }
  }

  const notturnoTitolare = profiles.find((profile) => profile.shiftType === 'night')
  const turnanteTitolare = profiles.find((profile) => profile.shiftType === 'rotating')
  if (
    turnanteFollowsNotturno &&
    notturnoTitolare && turnanteTitolare &&
    notturnoTitolare.restMode !== 'fixed' && turnanteTitolare.restMode !== 'fixed'
  ) {
    startWeekdayById[turnanteTitolare.id] = (startWeekdayById[notturnoTitolare.id]! + 2) % 7
  }

  const result: Record<string, boolean> = {}
  for (const profile of profiles) {
    result[profile.id] = profile.restMode === 'fixed'
      ? profile.fixedRestDays.includes(new Date(Date.UTC(year, month, day)).getUTCDay())
      : isRotatingRestDay(startWeekdayById[profile.id]!, year, month, day, pairsPerCycle)
  }
  return result
}

/** Rest days for every profile across a whole month, as ISO date strings. */
export function computeMonthRestDays(
  profiles: RestRotationProfile[],
  year: number,
  month: number,
  daysInMonth: number,
  turnanteFollowsNotturno: boolean,
  pairsPerCycle: number = DEFAULT_PAIRS_PER_CYCLE,
): Record<string, string[]> {
  const result: Record<string, string[]> = Object.fromEntries(profiles.map((profile) => [profile.id, []]))
  for (let day = 1; day <= daysInMonth; day += 1) {
    const perProfile = isRestDay(profiles, year, month, day, turnanteFollowsNotturno, pairsPerCycle)
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    for (const profile of profiles) {
      if (perProfile[profile.id]) result[profile.id]!.push(iso)
    }
  }
  return result
}

// Originally ported from Absnautilus/plannerturni's src/domain/restRotation.js.
// Field names are adapted to homisuite's schema and the weekday convention
// is 0=Sunday (matching fixed_rest_days / Date.getUTCDay, not the original
// app's own 0=Monday) -- the epoch below is anchored one day earlier than
// the original's to realign, so every mod-7 computation stays byte-for-byte
// the same, just relabeled.
//
// A rotating employee rests in consecutive pairs of 2 days a week, every 7
// days -- 5 working days between pairs. After `pairsPerCycle` consecutive
// pairs, the rest of the pattern needs to rotate back by one weekday (so the
// same employee doesn't always rest on, say, the same weekend). The
// original app did that with a single rest day in place of a pair; no rest
// turn is ever a single day now -- every rest is always a pair of 2. The
// rotation instead comes from a single SHORT working week (4 days instead
// of 5) right before that turn's pair: pairs are still exactly 7 days apart
// everywhere else, but the gap leading into the rotation pair is 6 days,
// and that missing day is what shifts the weekday back by 1 from then on.
// Pairs are generated in one continuous sequence (never as a pure function
// of the day alone) so the cadence never depends on where month boundaries
// fall.

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

// Walking forward from the epoch, generates rest events (always a [start,
// end] pair of epoch-day numbers, 2 days) for a given starting weekday,
// until past `throughEpochDay`. Every event starts exactly 7 days after the
// previous one's start (keeping 5 working days between rest turns) EXCEPT
// every (pairsPerCycle + 1)-th one, the rotation turn: that pair starts 6
// days after the previous one instead of 7 (a 4-working-day week, not the
// usual 5) and the weekday shifts back by 1 from there on -- that missing
// day is exactly what rotates the weekly pattern back, same effect the
// original single-day turn had, without ever leaving a lone rest day.
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
      start -= 1
      events.push([start, start + 1])
      weekday = ((weekday - 1) % 7 + 7) % 7
      start += 7
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
 * Reverse-engineers the rotationSlot that would reproduce a month of
 * manually-entered rest days exactly, by trying every one of the 7 possible
 * starting weekdays and keeping the one whose predicted rest days match the
 * real ones for every day of the month. Lets a property start from a month
 * laid out by hand (matching whatever real-world arrangement already exists)
 * and have every later month continue that exact cadence automatically,
 * instead of continuing from an arbitrarily assigned slot that happens to
 * land on different weekdays. Returns null when no single weekday
 * reproduces the given days -- e.g. the month wasn't filled in following the
 * pairs-of-2 pattern, or an exception was mixed in -- rather than guessing.
 */
export function inferRotationSlot(
  restDates: ReadonlySet<string>,
  year: number,
  month: number,
  daysInMonth: number,
  pairsPerCycle: number = DEFAULT_PAIRS_PER_CYCLE,
): number | null {
  for (let slot = 0; slot < 7; slot += 1) {
    const startWeekday = (slot * 2) % 7
    let matchesEveryDay = true
    for (let day = 1; day <= daysInMonth; day += 1) {
      const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      if (isRotatingRestDay(startWeekday, year, month, day, pairsPerCycle) !== restDates.has(iso)) {
        matchesEveryDay = false
        break
      }
    }
    if (matchesEveryDay) return slot
  }
  return null
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

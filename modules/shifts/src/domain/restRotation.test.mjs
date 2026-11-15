import assert from 'node:assert/strict'
import test from 'node:test'
import { isRestDay, nextFreeRotationSlot, computeMonthRestDays, inferRotationSlot } from './restRotation.ts'

// Walks day by day over a continuous range (crossing months and years) and
// groups a profile's consecutive rest days -- same helper shape as the
// original app's own test suite, since the invariants it checks don't
// depend on which weekday is labeled 0.
function continuousRestGroups(profile, startDate, endDate, turnanteFollowsNotturno = true, others = []) {
  const groups = []
  let current = null
  const cursor = new Date(startDate)
  while (cursor < endDate) {
    const year = cursor.getUTCFullYear()
    const month = cursor.getUTCMonth()
    const day = cursor.getUTCDate()
    const result = isRestDay([profile, ...others], year, month, day, turnanteFollowsNotturno)
    const index = Math.round((cursor - startDate) / 86_400_000)
    if (result[profile.id]) {
      if (current && current[current.length - 1] === index - 1) current.push(index)
      else { if (current) groups.push(current); current = [index] }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  if (current) groups.push(current)
  return groups
}

test('confirmed rule: every rest turn is a pair -- a short (4-day) work week rotates the pattern instead of a single day', () => {
  // The simulation window starts at an arbitrary point in the real cycle
  // (which runs from the epoch), so the observed PHASE of the pattern is
  // unpredictable (it may start mid-pair or right before a short week).
  // These assertions don't assume a fixed phase: they only check that (a)
  // every rest turn is a pair (never a single day), (b) every work week
  // between turns is 4 or 5 days, and (c) the 4-day weeks recur exactly
  // every 3 pairs (pairsPerCycle).
  const start = new Date(Date.UTC(2026, 6, 1))
  const end = new Date(Date.UTC(2028, 6, 1))
  for (let slot = 0; slot < 8; slot += 1) {
    const profile = { id: 'x', shiftType: 'day', restMode: 'rotating', rotationSlot: slot, fixedRestDays: [] }
    const groups = continuousRestGroups(profile, start, end)
    // Discard the first/last group: the window can cut them in half (e.g.
    // show only the second day of a pair that started before the window)
    // -- every INTERNAL group is always complete and genuine.
    const internal = groups.slice(1, -1)
    for (const [index, group] of internal.entries()) {
      assert.equal(group.length, 2, `slot ${slot}, turn ${index}: rest turn was not a pair (length ${group.length})`)
    }
    const workWeeks = []
    for (let i = 1; i < internal.length; i += 1) {
      const previousEnd = internal[i - 1][internal[i - 1].length - 1]
      const currentStart = internal[i][0]
      workWeeks.push(currentStart - previousEnd - 1)
    }
    for (const [index, days] of workWeeks.entries()) {
      assert.ok([4, 5].includes(days), `slot ${slot}, gap ${index}: invalid work week length ${days}`)
    }
    const shortIndexes = workWeeks.map((days, index) => (days === 4 ? index : -1)).filter((index) => index !== -1)
    assert.ok(shortIndexes.length > 1, `slot ${slot}: no 4-day work week found in the window`)
    for (let k = 1; k < shortIndexes.length; k += 1) {
      const distance = shortIndexes[k] - shortIndexes[k - 1]
      assert.equal(distance, 4, `slot ${slot}: two consecutive 4-day weeks ${distance} turns apart instead of 4 (3 pairs)`)
    }
    assert.ok(workWeeks.length > 8)
  }
})

test('the 4-day work week recurs with a fixed period of pairsPerCycle+1 rest turns', () => {
  const profile = { id: 'x', shiftType: 'day', restMode: 'rotating', rotationSlot: 2, fixedRestDays: [] }
  const start = new Date(Date.UTC(2026, 6, 1))
  const end = new Date(Date.UTC(2027, 6, 1))
  const groups = continuousRestGroups(profile, start, end).slice(1, -1)
  const workWeeks = []
  for (let i = 1; i < groups.length; i += 1) {
    const previousGroupEnd = groups[i - 1][groups[i - 1].length - 1]
    const currentGroupStart = groups[i][0]
    workWeeks.push(currentGroupStart - previousGroupEnd - 1)
  }
  for (const days of workWeeks) assert.ok([4, 5].includes(days))
  const period = 4 // pairsPerCycle (3) + 1
  for (let i = period; i < workWeeks.length; i += 1) {
    assert.equal(workWeeks[i], workWeeks[i - period], `gap ${i} should repeat the same length as gap ${i - period}`)
  }
})

test('a fixed-rest profile rests only on its configured weekdays, any month/year', () => {
  const profiles = [{ id: 1, shiftType: 'day', restMode: 'fixed', fixedRestDays: [6, 0], rotationSlot: null }] // Sat+Sun
  const a = isRestDay(profiles, 2026, 3, 4, true) // Saturday 4 April 2026
  const b = isRestDay(profiles, 2027, 8, 4, true) // Saturday 4 September 2027
  assert.equal(a[1], true)
  assert.equal(b[1], true)
})

test('a fixed-rest profile is never resting outside its configured weekdays', () => {
  const profiles = [{ id: 1, shiftType: 'day', restMode: 'fixed', fixedRestDays: [6, 0], rotationSlot: null }]
  const wednesday = isRestDay(profiles, 2026, 3, 1, true) // Wednesday 1 April 2026
  assert.equal(wednesday[1], false)
})

test('a rotating turnante rests 2 weekdays after a rotating notturno', () => {
  const profiles = [
    { id: 1, shiftType: 'night', restMode: 'rotating', rotationSlot: 0, fixedRestDays: [] },
    { id: 2, shiftType: 'rotating', restMode: 'rotating', rotationSlot: 1, fixedRestDays: [] },
  ]
  for (let day = 1; day <= 20; day += 1) {
    const today = isRestDay(profiles, 2026, 6, day, true)
    if (today[1]) {
      const twoLater = isRestDay(profiles, 2026, 6, day + 2, true)
      assert.equal(twoLater[2], true)
      return
    }
  }
  assert.fail('no rest day found in the test window')
})

test('the follow-notturno hook does not apply when either side is fixed-rest', () => {
  const profiles = [
    { id: 1, shiftType: 'night', restMode: 'fixed', fixedRestDays: [2, 3], rotationSlot: null },
    { id: 2, shiftType: 'rotating', restMode: 'rotating', rotationSlot: 1, fixedRestDays: [] },
  ]
  // the turnante must follow its own rotationSlot, not the notturno's fixed days
  const withHook = isRestDay(profiles, 2026, 6, 10, true)
  const withoutHook = isRestDay(profiles, 2026, 6, 10, false)
  assert.equal(withHook[2], withoutHook[2])
})

test('nextFreeRotationSlot assigns 0 when nobody has a slot yet', () => {
  assert.equal(nextFreeRotationSlot([]), 0)
})

test('nextFreeRotationSlot assigns the first free integer, not simply max+1', () => {
  const profiles = [{ rotationSlot: 0 }, { rotationSlot: 2 }, { rotationSlot: 3 }]
  assert.equal(nextFreeRotationSlot(profiles), 1)
})

test('nextFreeRotationSlot skips an integer that would reproduce a weekday already in use, even though that integer itself is free', () => {
  // Slots 0-7 are already taken property-wide (by this unit or others), so
  // the next free INTEGER is 8 -- but 8 and the existing slot-1 person land
  // on the same weekday (16 mod 7 === 2 mod 7 === 1*2 mod 7), so handing out
  // 8 would silently put a new hire to rest on the exact same days as that
  // slot-1 person. The picker must skip past it to slot 9 (weekday 4), the
  // next integer whose weekday isn't already taken in this unit.
  const propertyProfiles = [0, 1, 2, 3, 4, 5, 6, 7].map((rotationSlot) => ({ rotationSlot }))
  const unitProfiles = [{ id: 'existing', shiftType: 'day', restMode: 'rotating', rotationSlot: 1, fixedRestDays: [] }]
  assert.equal(nextFreeRotationSlot(propertyProfiles, unitProfiles), 9)
})

test('nextFreeRotationSlot keeps the turnante-follows-notturno weekday reserved even though no profile stores that slot directly', () => {
  // The turnante's own rotationSlot (2 -> weekday 4) is overridden at
  // render time by the notturno's weekday + 2 (0 + 2 = weekday 2) -- so a
  // new hire must avoid weekday 2 too, not just weekday 4, or they'd
  // collide with the turnante's real rest days instead of their nominal
  // (unused) ones.
  const propertyProfiles = [{ rotationSlot: 0 }, { rotationSlot: 2 }]
  const unitProfiles = [
    { id: 'notturno', shiftType: 'night', restMode: 'rotating', rotationSlot: 0, fixedRestDays: [] },
    { id: 'turnante', shiftType: 'rotating', restMode: 'rotating', rotationSlot: 2, fixedRestDays: [] },
  ]
  // Slot 1 (weekday 2) would collide with the turnante's real, overridden
  // rest days -- must be skipped even though no profile's own rotationSlot
  // is 1 or maps to weekday 2 on its own.
  assert.equal(nextFreeRotationSlot(propertyProfiles, unitProfiles, true), 3)
})

test('nextFreeRotationSlot falls back to pure free-integer behavior when no unit profiles are given', () => {
  // Omitting unitProfiles (e.g. a caller that hasn't wired the per-unit
  // weekday check) must not throw or change the original contract.
  assert.equal(nextFreeRotationSlot([{ rotationSlot: 1 }]), 0)
})

test('an existing rotationSlot does not change when another profile is removed or reordered', () => {
  const before = [
    { id: 1, shiftType: 'day', restMode: 'rotating', rotationSlot: 0, fixedRestDays: [] },
    { id: 2, shiftType: 'day', restMode: 'rotating', rotationSlot: 1, fixedRestDays: [] },
    { id: 3, shiftType: 'day', restMode: 'rotating', rotationSlot: 2, fixedRestDays: [] },
  ]
  const resultBefore = isRestDay(before, 2026, 5, 10, true)
  // remove profile 2 and reorder the array (simulates a delete + list refresh)
  const after = [
    { id: 3, shiftType: 'day', restMode: 'rotating', rotationSlot: 2, fixedRestDays: [] },
    { id: 1, shiftType: 'day', restMode: 'rotating', rotationSlot: 0, fixedRestDays: [] },
  ]
  const resultAfter = isRestDay(after, 2026, 5, 10, true)
  // profiles 1 and 3 must have the exact same rest state as before: removing
  // or reordering someone else must not perturb their rotation
  assert.equal(resultAfter[1], resultBefore[1])
  assert.equal(resultAfter[3], resultBefore[3])
})

test('inferRotationSlot recovers the exact slot that produced a month of rest days', () => {
  const year = 2026
  const month = 9 // October, 0-indexed
  const daysInMonth = 31
  for (let slot = 0; slot < 7; slot += 1) {
    const profile = { id: 'x', shiftType: 'day', restMode: 'rotating', rotationSlot: slot, fixedRestDays: [] }
    const restDays = computeMonthRestDays([profile], year, month, daysInMonth, true)
    const inferred = inferRotationSlot(new Set(restDays.x), year, month, daysInMonth)
    assert.equal(inferred, slot, `slot ${slot} was not recovered from its own generated month`)
  }
})

test('inferRotationSlot returns null for a set of dates that matches no slot', () => {
  // A single rest day with none of the surrounding pattern can't come from
  // any of the 7 possible weekday starts.
  const inferred = inferRotationSlot(new Set(['2026-10-07']), 2026, 9, 31)
  assert.equal(inferred, null)
})

test('inferRotationSlot returns null for an empty set (no rest days entered yet)', () => {
  const inferred = inferRotationSlot(new Set(), 2026, 9, 31)
  assert.equal(inferred, null)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { isRestDay, nextFreeRotationSlot } from './restRotation.ts'

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

test('confirmed rule: pair, pair, pair, single (then rotates and restarts)', () => {
  // The simulation window starts at an arbitrary point in the real cycle
  // (which runs from the epoch), so the observed PHASE of the pattern is
  // unpredictable (it may start mid-pair or right on a single). These
  // assertions don't assume a fixed phase: they only check that (a) every
  // group is length 1 or 2, and (b) singles are always separated by exactly
  // 3 pairs.
  const start = new Date(Date.UTC(2026, 6, 1))
  const end = new Date(Date.UTC(2028, 6, 1))
  for (let slot = 0; slot < 8; slot += 1) {
    const profile = { id: 'x', shiftType: 'day', restMode: 'rotating', rotationSlot: slot, fixedRestDays: [] }
    const groups = continuousRestGroups(profile, start, end)
    // Discard the first/last group: the window can cut them in half (e.g.
    // show only the second day of a pair that started before the window)
    // -- every INTERNAL group is always complete and genuine.
    const lengths = groups.slice(1, -1).map((group) => group.length)
    for (const [index, length] of lengths.entries()) {
      assert.ok([1, 2].includes(length), `slot ${slot}, event ${index}: invalid length ${length}`)
    }
    const singleIndexes = lengths.map((length, index) => (length === 1 ? index : -1)).filter((index) => index !== -1)
    assert.ok(singleIndexes.length > 1, `slot ${slot}: no single found in the window`)
    for (let k = 1; k < singleIndexes.length; k += 1) {
      const distance = singleIndexes[k] - singleIndexes[k - 1]
      assert.equal(distance, 4, `slot ${slot}: two consecutive singles ${distance} apart instead of 4 (3 pairs)`)
    }
    assert.ok(lengths.length > 8)
  }
})

test('exactly 5 working days between the end of a pair and the next single or pair', () => {
  const profile = { id: 'x', shiftType: 'day', restMode: 'rotating', rotationSlot: 2, fixedRestDays: [] }
  const start = new Date(Date.UTC(2026, 6, 1))
  const end = new Date(Date.UTC(2027, 6, 1))
  const groups = continuousRestGroups(profile, start, end).slice(1, -1)
  for (let i = 1; i < groups.length; i += 1) {
    const previousGroupEnd = groups[i - 1][groups[i - 1].length - 1]
    const currentGroupStart = groups[i][0]
    const workingDays = currentGroupStart - previousGroupEnd - 1
    assert.equal(workingDays, 5, `between group ${i - 1} and group ${i}`)
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

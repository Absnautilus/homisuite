import assert from 'node:assert/strict'
import test from 'node:test'
import { shiftPreviewProperties } from './fixtures.ts'

test('the preview compares a hotel-specific ruleset with a neutral hotel', () => {
  const palazzo = shiftPreviewProperties.find((property) => property.id === 'palazzo-veneziano')
  const aurora = shiftPreviewProperties.find((property) => property.id === 'hotel-aurora')

  assert.ok(palazzo)
  assert.ok(aurora)
  assert.equal(palazzo.units.length, 2)
  assert.match(palazzo.units[0].ruleSetName, /Palazzo Veneziano/)
  assert.match(aurora.units[0].ruleSetName, /Preset neutro/)
  assert.doesNotMatch(aurora.units[0].rules.hard.join(' '), /C2.*A1/)
})

test('every assignment references a code defined by its planning unit', () => {
  for (const property of shiftPreviewProperties) {
    for (const unit of property.units) {
      const codes = new Set(unit.codes.map(({ code }) => code))
      assert.equal(codes.size, unit.codes.length, `${unit.id} has duplicate shift codes`)
      for (const person of unit.people) {
        const assignments = unit.assignments[person.id]
        assert.equal(assignments.length, 7, `${person.id} does not have a full preview week`)
        for (const code of assignments) assert.ok(codes.has(code), `${unit.id} does not define ${code}`)
      }
    }
  }
})

test('planning units select job titles without changing Core profiles', () => {
  for (const property of shiftPreviewProperties) {
    for (const unit of property.units) {
      assert.ok(unit.jobTitles.length > 0)
      assert.equal(new Set([...unit.jobTitles, ...unit.excludedJobTitles]).size, unit.jobTitles.length + unit.excludedJobTitles.length)
      assert.ok(unit.people.every((person) => person.jobTitle && person.assignmentProfile))
    }
  }
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { generateSchedule } from './assignment.ts'
import { DEFAULT_ROLE_CODES } from './defaultRules.ts'

const COVERAGE = [
  { code: 'C1', quantity: 1 }, { code: 'C2', quantity: 1 },
  { code: 'A1', quantity: 1 }, { code: 'A2', quantity: 1 },
  { code: 'N', quantity: 1 },
]
const HARD_RULES = {
  sequenzaC2A1Vietata: true,
  prioritaNotturno: true,
  riposoTurnanteDopoNotturno: true,
  direttoreD1D2Auto: true,
  fomF1F2Auto: true,
  ceAutomatico: true,
}
const SOFT_RULE_ORDER = ['equilibrioMattinaPomeriggio', 'sequenzaPreferibileEvitata', 'equitaSequenzeScomode', 'variazioneSettimanale', 'preferenzePersonali']
const SOFT_RULES_ENABLED = Object.fromEntries(SOFT_RULE_ORDER.map((key) => [key, true]))
const CODE_KINDS = { C1: 'work', C2: 'work', A1: 'work', A2: 'work', N: 'work', D1: 'work', D2: 'work', F1: 'work', F2: 'work', CE: 'work', R: 'rest' }

function baseEmployees() {
  return [
    { id: '1', shiftType: 'director', active: true, restMode: 'fixed', fixedRestDays: [0, 6], rotationSlot: null },
    { id: '2', shiftType: 'fom', active: true, restMode: 'fixed', fixedRestDays: [0, 6], rotationSlot: null, extraCodes: ['C1', 'C2', 'A1', 'A2'] },
    { id: '3', shiftType: 'day', active: true, restMode: 'rotating', fixedRestDays: [], rotationSlot: 0 },
    { id: '4', shiftType: 'day', active: true, restMode: 'rotating', fixedRestDays: [], rotationSlot: 1 },
    { id: '5', shiftType: 'day', active: true, restMode: 'rotating', fixedRestDays: [], rotationSlot: 2 },
    { id: '6', shiftType: 'day', active: true, restMode: 'rotating', fixedRestDays: [], rotationSlot: 3 },
    { id: '7', shiftType: 'day', active: true, restMode: 'rotating', fixedRestDays: [], rotationSlot: 4 },
    { id: '8', shiftType: 'day', active: true, restMode: 'rotating', fixedRestDays: [], rotationSlot: 5, extraCodes: ['N'] },
    { id: '9', shiftType: 'rotating', active: true, restMode: 'rotating', fixedRestDays: [], rotationSlot: 6 },
    { id: '10', shiftType: 'night', active: true, restMode: 'rotating', fixedRestDays: [], rotationSlot: 7 },
  ]
}

function run(overrides = {}) {
  return generateSchedule({
    employees: baseEmployees(),
    existingAssignments: {},
    codeKinds: CODE_KINDS,
    year: 2026,
    month: 6,
    daysInMonth: 30,
    coverage: COVERAGE,
    hardRules: HARD_RULES,
    softRuleOrder: SOFT_RULE_ORDER,
    softRulesEnabled: SOFT_RULES_ENABLED,
    turnanteFollowsNotturno: true,
    restRotationPairsPerCycle: 3,
    roleCodes: DEFAULT_ROLE_CODES,
    random: Math.random,
    ...overrides,
  })
}

test('a permission-kind existing shift survives regeneration even without being locked', () => {
  const { assignments } = run({ existingAssignments: { '3': { '2026-07-10': { code: 'P', locked: false, kind: 'permission' } } } })
  assert.equal(assignments['3']['2026-07-10'], 'P')
})

test('a leave-kind existing shift survives regeneration even without being locked', () => {
  const { assignments } = run({ existingAssignments: { '4': { '2026-07-05': { code: 'F', locked: false, kind: 'leave' } } } })
  assert.equal(assignments['4']['2026-07-05'], 'F')
})

test('a plain work-kind shift that is not locked IS regenerated', () => {
  const { assignments } = run({ existingAssignments: { '3': { '2026-07-10': { code: 'C1', locked: false, kind: 'work' } } } })
  assert.ok(assignments['3']['2026-07-10'])
})

test('a locked shift survives regardless of its kind', () => {
  const { assignments } = run({ existingAssignments: { '3': { '2026-07-10': { code: 'C2', locked: true, kind: 'work' } } } })
  assert.equal(assignments['3']['2026-07-10'], 'C2')
})

test('an inactive employee is never touched: existing shift kept, no new shifts added', () => {
  const employees = baseEmployees().map((employee) => employee.id === '3' ? { ...employee, active: false } : employee)
  const { assignments } = run({ employees, existingAssignments: { '3': { '2026-07-01': { code: 'C1', locked: false, kind: 'work' } } } })
  assert.deepEqual(assignments['3'], { '2026-07-01': 'C1' })
})

test('generates a plan with no empty cells and no conflicts for a simple scenario', () => {
  const { assignments, conflicts } = run()
  let empty = 0
  for (const employee of baseEmployees()) {
    for (let day = 1; day <= 30; day += 1) {
      const date = `2026-07-${String(day).padStart(2, '0')}`
      if (!assignments[employee.id][date]) empty += 1
    }
  }
  assert.equal(empty, 0)
  assert.equal(conflicts.length, 0)
})

test('CE is assigned as a fallback to free day/rotating employees', () => {
  const { assignments } = run()
  const hasCe = Object.values(assignments).some((byDate) => Object.values(byDate).includes('CE'))
  assert.ok(hasCe)
})

test('a property with entirely different code sigle still schedules via its own roleCodes', () => {
  const employees = [
    { id: 'a', shiftType: 'day', active: true, restMode: 'rotating', fixedRestDays: [], rotationSlot: 0 },
    { id: 'b', shiftType: 'day', active: true, restMode: 'rotating', fixedRestDays: [], rotationSlot: 1 },
  ]
  const roleCodes = { day: { base: ['M1', 'M2'], extra: [] } }
  const { assignments } = generateSchedule({
    employees,
    existingAssignments: {},
    codeKinds: { M1: 'work', M2: 'work', R: 'rest' },
    year: 2026,
    month: 6,
    daysInMonth: 7,
    coverage: [{ code: 'M1', quantity: 1 }, { code: 'M2', quantity: 1 }],
    hardRules: {},
    softRuleOrder: [],
    softRulesEnabled: {},
    turnanteFollowsNotturno: false,
    restRotationPairsPerCycle: 3,
    roleCodes,
  })
  const codesUsed = new Set(Object.values(assignments).flatMap((byDate) => Object.values(byDate)))
  assert.ok(codesUsed.has('M1') || codesUsed.has('M2'))
})

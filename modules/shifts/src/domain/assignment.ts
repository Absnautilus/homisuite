// Ported from Absnautilus/plannerturni's src/domain/assignment.js
// (generateSchedule), the tested auto-assignment engine behind "Assegna
// automaticamente". Unlike the original, which hardcoded which codes each
// role can cover (day -> C1/C2/A1/A2, etc.) for its one hotel, homisuite is
// multi-property with freely-named codes per property: that mapping
// (`roleCodes`, see defaultRules.ts) is a caller-supplied input, not a
// constant here, so every property can define its own. A few soft-rule
// refinements (morning/afternoon balance, the C1->A1/C2->A2 sequence to
// avoid, the N/C1/C2/A1/A2 coverage-processing order) still reference those
// specific sigle; they degrade gracefully to a no-op for a property that
// doesn't use them, rather than breaking anything. Employee shift-day
// preferences (`preferenzePersonali` in the original) have no backend yet in
// homisuite, so that comparator is a permanent no-op here (equivalent to
// "nobody has preferences set", which was already a valid, neutral code path
// in the original).
import { isRestDay, type RestRotationProfile } from './restRotation.ts'
import type { RoleCodes } from './defaultRules.ts'

export interface AssignmentEmployee {
  id: string
  shiftType: 'day' | 'night' | 'rotating' | 'director' | 'fom' | 'custom'
  active: boolean
  restMode: 'fixed' | 'rotating'
  fixedRestDays: number[]
  rotationSlot: number | null
  extraCodes?: string[]
}

export type ShiftCodeKind = 'work' | 'rest' | 'leave' | 'permission' | 'absence'

export interface ExistingShift {
  code: string
  locked: boolean
  kind: ShiftCodeKind
}

export interface CoverageRule {
  code: string
  quantity: number
}

export interface AssignmentConflict {
  date: string | null
  code: string | null
  message: string
}

export interface GenerateScheduleInput {
  employees: AssignmentEmployee[]
  existingAssignments: Record<string, Record<string, ExistingShift>>
  codeKinds: Record<string, ShiftCodeKind>
  year: number
  month: number // 0-indexed, matching Date.UTC
  daysInMonth: number
  coverage: CoverageRule[]
  hardRules: Record<string, boolean>
  softRuleOrder: string[]
  softRulesEnabled: Record<string, boolean>
  turnanteFollowsNotturno: boolean
  restRotationPairsPerCycle: number
  roleCodes: Record<string, RoleCodes>
  random?: () => number
}

export interface GenerateScheduleResult {
  assignments: Record<string, Record<string, string>>
  conflicts: AssignmentConflict[]
}

const MORNING_CODES = ['A1', 'A2']
const AFTERNOON_CODES = ['C1', 'C2']
const PREFERABLE_SEQUENCE_MAP: Record<string, string> = { A1: 'C1', A2: 'C2' }
const PREFERRED_COVERAGE_ORDER = ['N', 'C1', 'C2', 'A1', 'A2']

function baseCodesFor(employee: AssignmentEmployee, roleCodes: Record<string, RoleCodes>): string[] {
  return roleCodes[employee.shiftType]?.base ?? []
}
function extraCodesFor(employee: AssignmentEmployee, roleCodes: Record<string, RoleCodes>): string[] {
  return [...new Set([...(roleCodes[employee.shiftType]?.extra ?? []), ...(employee.extraCodes ?? [])])]
}
function categoryOf(code: string | undefined): 'morning' | 'afternoon' | null {
  if (code == null) return null
  if (MORNING_CODES.includes(code)) return 'morning'
  if (AFTERNOON_CODES.includes(code)) return 'afternoon'
  return null
}
function formatDate(day: number, month: number, year: number): string {
  return `${String(day).padStart(2, '0')}/${String(month + 1).padStart(2, '0')}/${String(year).slice(-2)}`
}

/**
 * Pure scheduling engine: no I/O, no mutation of its inputs. Resets every
 * non-protected cell for active employees in the given month, then fills
 * rest days, coverage shifts, director/FOM alternation and CE filler, in
 * that order -- matching the original's four-step structure. Inactive
 * employees and protected cells (locked, or an absence/leave/permission
 * label) are carried over untouched.
 */
export function generateSchedule(input: GenerateScheduleInput): GenerateScheduleResult {
  const {
    employees, existingAssignments, codeKinds, year, month, daysInMonth, coverage,
    hardRules, softRuleOrder, softRulesEnabled, turnanteFollowsNotturno,
    restRotationPairsPerCycle, roleCodes, random = Math.random,
  } = input

  const activeEmployees = employees.filter((employee) => employee.active !== false)
  const days = Array.from({ length: daysInMonth }, (_, index) => index + 1)
  const isoDate = (day: number) => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const isCoverageCode = (code: string | undefined) => code != null && codeKinds[code] === 'work'

  const codeOf: Record<string, Record<string, string>> = {}
  for (const employee of employees) {
    codeOf[employee.id] = {}
    const existingForEmployee = existingAssignments[employee.id] ?? {}
    const isActive = employee.active !== false
    for (const [date, shift] of Object.entries(existingForEmployee)) {
      if (!isActive) { codeOf[employee.id]![date] = shift.code; continue }
      const cellProtected = shift.locked || (shift.kind !== 'work' && shift.code !== 'R')
      if (cellProtected) codeOf[employee.id]![date] = shift.code
    }
  }

  const get = (employeeId: string, date: string) => codeOf[employeeId]?.[date]
  const set = (employeeId: string, date: string, code: string) => { codeOf[employeeId] ??= {}; codeOf[employeeId]![date] = code }

  const conflicts: AssignmentConflict[] = []

  // --- Step 1: rest days ---
  const restProfiles: RestRotationProfile[] = activeEmployees.map((employee) => ({
    id: employee.id, shiftType: employee.shiftType, restMode: employee.restMode,
    fixedRestDays: employee.fixedRestDays, rotationSlot: employee.rotationSlot,
  }))
  for (const day of days) {
    const date = isoDate(day)
    const restByEmployee = isRestDay(restProfiles, year, month, day, turnanteFollowsNotturno, restRotationPairsPerCycle)
    for (const employee of activeEmployees) {
      if (get(employee.id, date) != null) continue
      if (restByEmployee[employee.id]) set(employee.id, date, 'R')
    }
  }

  const weekCountOf = (employeeId: string, day: number, code: string) => {
    const weekStart = day - ((day - 1) % 7)
    const weekEnd = Math.min(weekStart + 6, daysInMonth)
    let count = 0
    for (let d = weekStart; d <= weekEnd; d += 1) if (get(employeeId, isoDate(d)) === code) count += 1
    return count
  }
  const monthCoverageCountOf = (employeeId: string) => days.filter((day) => isCoverageCode(get(employeeId, isoDate(day)))).length
  const categoryCountOf = (employeeId: string, category: 'morning' | 'afternoon') =>
    days.filter((day) => categoryOf(get(employeeId, isoDate(day))) === category).length
  const violatesPreferableSequence = (employeeId: string, code: string, day: number) => {
    if (day <= 1) return false
    const previousCode = PREFERABLE_SEQUENCE_MAP[code]
    if (!previousCode) return false
    return get(employeeId, isoDate(day - 1)) === previousCode
  }
  const awkwardSequenceCountSoFar = (employeeId: string, day: number) => {
    let count = 0
    for (let g = 1; g < day; g += 1) {
      const today = get(employeeId, isoDate(g))
      const tomorrow = get(employeeId, isoDate(g + 1))
      if ((today === 'C1' && tomorrow === 'A1') || (today === 'C2' && tomorrow === 'A2')) count += 1
    }
    return count
  }

  const comparators: Record<string, (a: AssignmentEmployee, b: AssignmentEmployee, code: string, day: number) => number> = {
    sequenzaPreferibileEvitata: (a, b, code, day) =>
      (violatesPreferableSequence(a.id, code, day) ? 1 : 0) - (violatesPreferableSequence(b.id, code, day) ? 1 : 0),
    equitaSequenzeScomode: (a, b, _code, day) => awkwardSequenceCountSoFar(a.id, day) - awkwardSequenceCountSoFar(b.id, day),
    equilibrioMattinaPomeriggio: (a, b, code) => {
      const category = categoryOf(code)
      if (!category) return 0
      const opposite = category === 'morning' ? 'afternoon' : 'morning'
      const imbalanceA = categoryCountOf(a.id, category) - categoryCountOf(a.id, opposite)
      const imbalanceB = categoryCountOf(b.id, category) - categoryCountOf(b.id, opposite)
      return imbalanceA - imbalanceB
    },
    variazioneSettimanale: (a, b, code, day) => weekCountOf(a.id, day, code) - weekCountOf(b.id, day, code),
    preferenzePersonali: () => 0,
  }

  function sortCandidates(list: AssignmentEmployee[], code: string, day: number): AssignmentEmployee[] {
    const withRandom = list.map((employee) => ({ employee, r: random() }))
    withRandom.sort((x, y) => {
      const a = x.employee, b = y.employee
      if (hardRules.prioritaNotturno && code === 'N') {
        const rankA = a.shiftType === 'night' ? 0 : 1
        const rankB = b.shiftType === 'night' ? 0 : 1
        if (rankA !== rankB) return rankA - rankB
      }
      for (const key of softRuleOrder) {
        if (!softRulesEnabled[key]) continue
        const comparator = comparators[key]
        if (!comparator) continue
        const result = comparator(a, b, code, day)
        if (result !== 0) return result
      }
      const balanceA = monthCoverageCountOf(a.id)
      const balanceB = monthCoverageCountOf(b.id)
      if (balanceA !== balanceB) return balanceA - balanceB
      return x.r - y.r
    })
    return withRandom.map((x) => x.employee)
  }

  // --- Step 2: coverage shifts ---
  const coverageByCode = new Map(coverage.map((rule) => [rule.code, rule.quantity]))
  const codeOrder = [
    ...PREFERRED_COVERAGE_ORDER.filter((code) => coverageByCode.has(code)),
    ...coverage.map((rule) => rule.code).filter((code) => !PREFERRED_COVERAGE_ORDER.includes(code)),
  ]

  for (const day of days) {
    const date = isoDate(day)
    for (const code of codeOrder) {
      const quantity = coverageByCode.get(code)!
      const alreadyAssigned = activeEmployees.filter((employee) => get(employee.id, date) === code).length
      const remaining = quantity - alreadyAssigned
      if (remaining <= 0) continue

      const isFree = (employee: AssignmentEmployee) => get(employee.id, date) == null
      const violatesSequenceBan = (employee: AssignmentEmployee) =>
        hardRules.sequenzaC2A1Vietata === true && code === 'A1' && get(employee.id, isoDate(day - 1)) === 'C2'
      const violatesNightRotationRule = (employee: AssignmentEmployee) => {
        if (!hardRules.prioritaNotturno || code !== 'N' || employee.shiftType !== 'rotating') return false
        let restDistance: number | null = null
        for (let g = day; g <= daysInMonth; g += 1) {
          if (get(employee.id, isoDate(g)) === 'R') { restDistance = g - day; break }
        }
        return restDistance !== null && restDistance > 2
      }

      const baseCandidates = activeEmployees.filter((employee) =>
        baseCodesFor(employee, roleCodes).includes(code) && isFree(employee) && !violatesSequenceBan(employee) && !violatesNightRotationRule(employee))
      const reserveCandidates = activeEmployees.filter((employee) =>
        extraCodesFor(employee, roleCodes).includes(code) && isFree(employee) && !violatesSequenceBan(employee))

      const pool = [...sortCandidates(baseCandidates, code, day), ...sortCandidates(reserveCandidates, code, day)]

      for (let i = 0; i < remaining; i += 1) {
        const chosen = pool[i]
        if (chosen) {
          set(chosen.id, date, code)
        } else {
          conflicts.push({
            date, code,
            message: `Giorno ${formatDate(day, month, year)}: nessun dipendente disponibile per ${code} (${alreadyAssigned}/${quantity} coperti). Slot lasciato vuoto.`,
          })
        }
      }
    }
  }

  // --- Step 3: Direttore (D1/D2) e FOM (F1/F2) alternation ---
  function assignAlternating(employee: AssignmentEmployee | undefined, pair: [string, string]) {
    if (!employee) return
    for (const day of days) {
      const date = isoDate(day)
      if (get(employee.id, date) != null) continue
      const counts = pair.map((code) => weekCountOf(employee.id, day, code)) as [number, number]
      const chosen = counts[0] === counts[1] ? pair[random() < 0.5 ? 0 : 1] : (counts[0] < counts[1] ? pair[0] : pair[1])
      set(employee.id, date, chosen)
    }
  }
  const director = activeEmployees.find((employee) => employee.shiftType === 'director')
  const fom = activeEmployees.find((employee) => employee.shiftType === 'fom')
  if (hardRules.direttoreD1D2Auto) assignAlternating(director, ['D1', 'D2'])
  if (hardRules.fomF1F2Auto) assignAlternating(fom, ['F1', 'F2'])

  // --- Step 4: CE as a fallback for otherwise-free day/rotating employees ---
  if (hardRules.ceAutomatico) {
    for (const employee of activeEmployees) {
      if (employee.shiftType !== 'day' && employee.shiftType !== 'rotating') continue
      for (const day of days) {
        const date = isoDate(day)
        if (get(employee.id, date) == null) set(employee.id, date, 'CE')
      }
    }
  }

  return { assignments: codeOf, conflicts }
}

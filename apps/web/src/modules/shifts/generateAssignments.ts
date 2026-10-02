import type { SupabaseClient } from '@supabase/supabase-js'
import {
  DEFAULT_HARD_RULES, DEFAULT_SOFT_RULES, generateSchedule, initRestRotationPairsPerCycle,
  initRoleCodes, initRuleEnabled, initRuleOrder,
  type AssignmentConflict, type AssignmentEmployee, type CoverageRule, type ExistingShift, type ShiftCodeKind, type ShiftPlanningUnit,
} from '@homisuite/shifts-module'
import { ensureRotationSlots, type StaffProfileRow } from './ensureRotationSlots'

export interface GenerateAssignmentsResult {
  assignments: Record<string, Record<string, string>>
  conflicts: AssignmentConflict[]
}

interface ShiftCodeRow { id: string; code: string; kind: string }
interface PreferenceStaffRow extends StaffProfileRow { preferred_shift_codes?: string[]; weekday_shift_preferences?: Record<string, string[]> }
interface ExistingShiftRow {
  id: string
  staff_profile_id: string
  shift_date: string
  locked: boolean
  shift_codes: { code: string; kind: string } | { code: string; kind: string }[] | null
}

function relatedCode(row: ExistingShiftRow) {
  return Array.isArray(row.shift_codes) ? row.shift_codes[0] : row.shift_codes
}

function parseCoverage(coverage: string[]): CoverageRule[] {
  return coverage.map((entry) => {
    const [quantityText, code] = entry.split(' × ')
    return { code: code ?? entry, quantity: Number(quantityText) || 0 }
  }).filter((rule) => rule.quantity > 0)
}

function nextMonthStart(year: number, month: number): string {
  return new Date(Date.UTC(year, month + 1, 1)).toISOString().slice(0, 10)
}

/**
 * "Assegna automaticamente": runs domain/assignment.ts's generateSchedule
 * against the unit's current staff, codes, coverage and rules, then writes
 * only what changed -- deletes the non-protected existing shifts for the
 * month (not locked, and either a work-kind code or 'R') and inserts the
 * newly computed ones. Protected shifts (locked, or an absence/leave/
 * permission code) are never touched, matching the original app's guard.
 */
export async function generateUnitAssignments(
  supabase: SupabaseClient,
  propertyId: string,
  profileId: string,
  unit: ShiftPlanningUnit,
): Promise<GenerateAssignmentsResult> {
  if (unit.monthStatus === 'final') throw new Error('Il mese è Definitivo: riporta il mese a Bozza per modificarlo.')
  if (!unit.month) throw new Error('Mese non disponibile per questa unità.')
  const [yearText, monthText] = unit.month.split('-')
  const year = Number(yearText)
  const month = Number(monthText) - 1 // 0-indexed, matching Date.UTC
  const daysInMonth = unit.assignmentDates?.length ?? new Date(Date.UTC(year, month + 1, 0)).getUTCDate()

  const memberIds = unit.people.map((person) => person.id)
  if (memberIds.length === 0) return { assignments: {}, conflicts: [] }

  const [{ data: unitStaff, error: unitStaffError }, { data: unitMembers, error: unitMembersError }, { data: unitCodes, error: unitCodesError }, { data: existingShifts, error: existingShiftsError }] = await Promise.all([
    supabase.from('shift_staff_profiles').select('id,shift_type,rest_mode,fixed_rest_days,rotation_slot,preferred_shift_codes,weekday_shift_preferences').eq('property_id', propertyId).in('id', memberIds),
    supabase.from('shift_unit_members').select('staff_profile_id,assignment_profile_key').eq('property_id', propertyId).eq('planning_unit_id', unit.id).in('staff_profile_id', memberIds),
    supabase.from('shift_codes').select('id,code,kind').eq('property_id', propertyId).eq('planning_unit_id', unit.id),
    supabase.from('shifts').select('id,staff_profile_id,shift_date,locked,shift_codes!inner(code,kind)').eq('property_id', propertyId).eq('planning_unit_id', unit.id).gte('shift_date', `${unit.month}-01`).lt('shift_date', nextMonthStart(year, month)),
  ])
  if (unitStaffError) throw unitStaffError
  if (unitMembersError) throw unitMembersError
  if (unitCodesError) throw unitCodesError
  if (existingShiftsError) throw existingShiftsError

  const unitStaffRows = (unitStaff ?? []) as PreferenceStaffRow[]
  const newSlotByProfileId = await ensureRotationSlots(supabase, propertyId, unitStaffRows)
  // The employee's scheduling role (day/night/rotating/fom/director) is set
  // per planning-unit membership (shift_unit_members.assignment_profile_key
  // -- what the "Tipo turno" column in the Employees panel shows), not on
  // shift_staff_profiles.shift_type, which is a leftover onboarding default
  // ('day' for almost everyone) that the engine must not schedule against.
  const roleByStaffId = new Map((unitMembers ?? []).map((row) => [String(row.staff_profile_id), row.assignment_profile_key as string | null]))

  const employees: AssignmentEmployee[] = unitStaffRows.map((staff) => ({
    id: staff.id,
    shiftType: (roleByStaffId.get(staff.id) ?? staff.shift_type) as AssignmentEmployee['shiftType'],
    active: true,
    restMode: staff.rest_mode as AssignmentEmployee['restMode'],
    fixedRestDays: staff.fixed_rest_days ?? [],
    rotationSlot: newSlotByProfileId.get(staff.id) ?? staff.rotation_slot,
    preferredShiftCodes: staff.preferred_shift_codes ?? [],
    weekdayShiftPreferences: staff.weekday_shift_preferences ?? {},
  }))

  const roleCodes = initRoleCodes(unit.rules.roleCodes)

  // "Tocca al backup": when both the notturno titolare and the rotating
  // turnante are unavailable that day (rest, leave...), the night code
  // falls to whoever is the diurno right above the turnante in the
  // Employees panel order -- not a fixed person, so moving someone in that
  // list changes who backs up the turnante. Modeled as a reserve code for
  // just that employee: generateSchedule only reaches for reserve
  // candidates once the base pool (notturno + turnante) is exhausted, which
  // already is exactly "both are out" -- no separate condition needed.
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]))
  const orderedStaffIds = unit.people.map((person) => person.id)
  const turnanteIndex = orderedStaffIds.findIndex((id) => employeeById.get(id)?.shiftType === 'rotating')
  if (turnanteIndex > 0) {
    for (let i = turnanteIndex - 1; i >= 0; i -= 1) {
      const backup = employeeById.get(orderedStaffIds[i]!)
      if (backup?.shiftType === 'day') {
        backup.extraCodes = [...new Set([...(backup.extraCodes ?? []), ...(roleCodes.night?.base ?? [])])]
        break
      }
    }
  }

  const codeRows = (unitCodes ?? []) as ShiftCodeRow[]
  const codeIdByCode = new Map(codeRows.map((row) => [row.code, row.id]))
  const codeKinds = Object.fromEntries(codeRows.map((row) => [row.code, row.kind])) as Record<string, ShiftCodeKind>

  const existingRows = (existingShifts ?? []) as ExistingShiftRow[]
  const existingAssignments: Record<string, Record<string, ExistingShift>> = {}
  const existingIdByKey = new Map<string, string>()
  const regeneratableKeys = new Set<string>()
  for (const row of existingRows) {
    const code = relatedCode(row)
    if (!code) continue
    const key = `${row.staff_profile_id}_${row.shift_date}`
    existingAssignments[row.staff_profile_id] ??= {}
    existingAssignments[row.staff_profile_id]![row.shift_date] = { code: code.code, locked: row.locked, kind: code.kind as ShiftCodeKind }
    existingIdByKey.set(key, row.id)
    if (!row.locked && (code.kind === 'work' || code.code === 'R')) regeneratableKeys.add(key)
  }

  const hardRules = initRuleEnabled(DEFAULT_HARD_RULES, unit.rules.hard)
  const { assignments, conflicts } = generateSchedule({
    employees,
    existingAssignments,
    codeKinds,
    year,
    month,
    daysInMonth,
    coverage: parseCoverage(unit.rules.coverage),
    hardRules,
    softRuleOrder: initRuleOrder(DEFAULT_SOFT_RULES, unit.rules.soft),
    softRulesEnabled: initRuleEnabled(DEFAULT_SOFT_RULES, unit.rules.soft),
    turnanteFollowsNotturno: hardRules.riposoTurnanteDopoNotturno ?? true,
    restRotationPairsPerCycle: initRestRotationPairsPerCycle(unit.rules.restRotationPairsPerCycle),
    roleCodes,
  })

  const idsToDelete = [...regeneratableKeys].map((key) => existingIdByKey.get(key)).filter((id): id is string => id != null)
  if (idsToDelete.length > 0) {
    const { error: deleteError } = await supabase.from('shifts').delete().in('id', idsToDelete)
    if (deleteError) throw deleteError
  }

  const changed: Record<string, Record<string, string>> = {}
  const rows: Array<{ property_id: string; planning_unit_id: string; staff_profile_id: string; shift_code_id: string; shift_date: string; source: 'automatic'; created_by: string }> = []
  for (const employee of employees) {
    for (const [date, code] of Object.entries(assignments[employee.id] ?? {})) {
      const key = `${employee.id}_${date}`
      const wasKeptAsProtected = existingAssignments[employee.id]?.[date] != null && !regeneratableKeys.has(key)
      if (wasKeptAsProtected) continue
      const codeId = codeIdByCode.get(code)
      if (!codeId) {
        conflicts.push({ date, code, message: `Codice turno "${code}" non configurato per questa unità: cella lasciata vuota.` })
        continue
      }
      rows.push({ property_id: propertyId, planning_unit_id: unit.id, staff_profile_id: employee.id, shift_code_id: codeId, shift_date: date, source: 'automatic', created_by: profileId })
      changed[employee.id] ??= {}
      changed[employee.id]![date] = code
    }
  }
  if (rows.length > 0) {
    const { error: insertError } = await supabase.from('shifts').insert(rows)
    if (insertError) throw insertError
  }

  return { assignments: changed, conflicts }
}

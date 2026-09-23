import type { SupabaseClient } from '@supabase/supabase-js'
import type { ShiftPlanningUnit, ShiftPreviewProperty } from '@homisuite/shifts-module'

type Row = Record<string, unknown>

type RelatedRow = Record<string, unknown>
function related(value: unknown): RelatedRow | undefined {
  if (Array.isArray(value)) return value[0] as RelatedRow | undefined
  return value && typeof value === 'object' ? value as RelatedRow : undefined
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('')
}

function timeLabel(start: string | null, end: string | null) {
  if (!start || !end) return ''
  return `${start.slice(0, 5)}–${end.slice(0, 5)}`
}

function assignmentProfile(value: string) {
  const labels: Record<string, string> = {
    day: 'Diurno', night: 'Notturno', rotating: 'Turnante', director: 'Direttore', fom: 'FOM',
  }
  return labels[value] ?? value
}

function restDays(days: number[]) {
  const labels = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab']
  return days.map((day) => labels[day] ?? String(day)).join(' + ')
}

export interface LiveShiftData {
  property: ShiftPreviewProperty
  month: string
}

/**
 * Read model for the first live Turni slice.
 *
 * The module package stays independent from Supabase: the Shell owns auth,
 * property selection and data access, then passes a plain domain projection
 * into @homisuite/shifts-module. Preview fixtures therefore remain usable
 * without a backend.
 */
export async function loadLiveShiftData(
  supabase: SupabaseClient,
  propertyId: string,
  propertyName: string,
  month = new Date().toISOString().slice(0, 7),
): Promise<LiveShiftData> {
  const monthStart = `${month}-01`
  const nextMonth = new Date(`${monthStart}T00:00:00Z`)
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1)
  const nextMonthStart = nextMonth.toISOString().slice(0, 10)

  const { data: units, error: unitsError } = await supabase
    .from('shift_planning_units')
    .select('id,name,current_rule_set_id')
    .eq('property_id', propertyId)
    .eq('status', 'active')
    .order('name')
  if (unitsError) throw unitsError

  if (!units?.length) return { property: { id: propertyId, name: propertyName, units: [] }, month }

  const unitRows = units as Row[]
  const unitIds = unitRows.map((unit) => String(unit.id))
  const [
    codesResult,
    membersResult,
    rulesResult,
    shiftsResult,
    monthStatesResult,
  ] = await Promise.all([
    supabase.from('shift_codes').select('id,planning_unit_id,code,label,kind,starts_at,ends_at,color').eq('property_id', propertyId).in('planning_unit_id', unitIds).eq('active', true),
    supabase.from('shift_unit_members').select('id,planning_unit_id,staff_profile_id,assignment_profile_key,inclusion_source,shift_staff_profiles!inner(id,profile_id,shift_type,rest_mode,fixed_rest_days,active,profiles!inner(id,display_name),property_staff_details!inner(job_title_id,property_job_titles(name)))').eq('property_id', propertyId).in('planning_unit_id', unitIds).eq('active', true),
    supabase.from('shift_rule_sets').select('id,planning_unit_id,version,preset_key,rules').eq('property_id', propertyId).in('planning_unit_id', unitIds),
    supabase.from('shifts').select('planning_unit_id,staff_profile_id,shift_date,locked,shift_codes!inner(code)').eq('property_id', propertyId).gte('shift_date', monthStart).lt('shift_date', nextMonthStart),
    supabase.from('shift_month_states').select('planning_unit_id,status').eq('property_id', propertyId).eq('month', monthStart),
  ])

  for (const result of [codesResult, membersResult, rulesResult, shiftsResult, monthStatesResult]) {
    if (result.error) throw result.error
  }

  const codes = (codesResult.data ?? []) as Row[]
  const members = (membersResult.data ?? []) as Row[]
  const ruleSets = (rulesResult.data ?? []) as Row[]
  const shifts = (shiftsResult.data ?? []) as Row[]
  const monthStates = (monthStatesResult.data ?? []) as Row[]

  const assignmentDates = Array.from({ length: Math.round((nextMonth.getTime() - new Date(`${monthStart}T00:00:00Z`).getTime()) / 86400000) }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`)

  const projectedUnits: ShiftPlanningUnit[] = unitRows.map((unit) => {
    const unitMembers = members.filter((member) => member.planning_unit_id === unit.id)
    const activeRule = ruleSets.find((rule) => rule.id === unit.current_rule_set_id)
    const rules = related(activeRule?.rules) ?? {}
    const assignments: Record<string, string[]> = {}
    const lockedAssignments: Record<string, string[]> = {}

    for (const member of unitMembers) {
      const memberShifts = shifts.filter((shift) => shift.planning_unit_id === unit.id && shift.staff_profile_id === member.staff_profile_id)
      const staffProfileId = String(member.staff_profile_id)
      assignments[staffProfileId] = assignmentDates.map((date) => {
        const shift = memberShifts.find((candidate) => candidate.shift_date === date)
        const shiftCode = related(shift?.shift_codes)
        return typeof shiftCode?.code === 'string' ? shiftCode.code : ''
      })
      lockedAssignments[staffProfileId] = memberShifts.filter((shift) => shift.locked === true).map((shift) => String(shift.shift_date))
    }

    return {
      id: String(unit.id),
      name: typeof unit.name === 'string' ? unit.name : 'Unità',
      jobTitles: [],
      excludedJobTitles: [],
      ruleSetName: typeof activeRule?.preset_key === 'string' ? activeRule.preset_key : (typeof unit.name === 'string' ? unit.name : 'Unità'),
      ruleSetVersion: typeof activeRule?.version === 'number' ? activeRule.version : 1,
      codes: codes.filter((code) => code.planning_unit_id === unit.id).map((code) => ({
        code: String(code.code),
        label: typeof code.label === 'string' ? code.label : String(code.code),
        time: timeLabel(typeof code.starts_at === 'string' ? code.starts_at : null, typeof code.ends_at === 'string' ? code.ends_at : null),
        color: typeof code.color === 'string' ? code.color : '#9AA0A6',
      })),
      people: unitMembers.filter((member) => related(member.shift_staff_profiles)?.active !== false).map((member) => {
        const staff = related(member.shift_staff_profiles)
        const profile = related(staff?.profiles)
        const detail = related(staff?.property_staff_details)
        const jobTitle = related(detail?.property_job_titles)
        const title = typeof jobTitle?.name === 'string' ? jobTitle.name : undefined
        const name = typeof profile?.display_name === 'string' ? profile.display_name : 'Dipendente'
        return {
          id: String(member.staff_profile_id),
          name,
          initials: initials(name),
          jobTitle: title ?? '—',
          assignmentProfile: assignmentProfile(typeof member.assignment_profile_key === 'string' ? member.assignment_profile_key : (typeof staff?.shift_type === 'string' ? staff.shift_type : 'day')),
          includedBy: member.inclusion_source === 'explicit_include' ? 'manual' : 'job-title',
          restMode: staff?.rest_mode === 'fixed' ? 'fixed' : 'rotating',
          restDays: staff?.rest_mode === 'fixed' ? restDays(Array.isArray(staff.fixed_rest_days) ? staff.fixed_rest_days.filter((day): day is number => typeof day === 'number') : []) : undefined,
        }
      }),
      assignments,
      assignmentDates,
      lockedAssignments,
      month,
      monthStatus: monthStates.find((state) => state.planning_unit_id === unit.id)?.status === 'final' ? 'final' : 'draft',
      rules: {
        coverage: Array.isArray(rules.coverage) ? rules.coverage.map(String) : [],
        hard: Array.isArray(rules.hard) ? rules.hard.map(String) : [],
        soft: Array.isArray(rules.soft) ? rules.soft.map(String) : [],
      },
    }
  })

  return { property: { id: propertyId, name: propertyName, units: projectedUnits }, month }
}

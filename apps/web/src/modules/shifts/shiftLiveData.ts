import type { SupabaseClient } from '@supabase/supabase-js'
import { contrastTextColor, type ShiftPlanningUnit, type ShiftPreviewProperty } from '@homisuite/shifts-module'

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

  const { data: jobTitlesData, error: jobTitlesError } = await supabase
    .from('property_job_titles')
    .select('id,name')
    .eq('property_id', propertyId)
    .eq('active', true)
    .order('name')
  if (jobTitlesError) throw jobTitlesError
  const jobTitleRoster = (jobTitlesData ?? []).map((row) => ({ id: String(row.id), name: String(row.name) }))

  if (!units?.length) return { property: { id: propertyId, name: propertyName, units: [], jobTitleRoster }, month }

  const unitRows = units as Row[]
  const unitIds = unitRows.map((unit) => String(unit.id))
  const [
    codesResult,
    membersResult,
    rulesResult,
    shiftsResult,
    monthStatesResult,
    unitJobTitlesResult,
  ] = await Promise.all([
    supabase.from('shift_codes').select('id,planning_unit_id,code,label,kind,starts_at,ends_at,color,active').eq('property_id', propertyId).in('planning_unit_id', unitIds).eq('active', true),
    supabase.from('shift_unit_members').select('id,planning_unit_id,staff_profile_id,assignment_profile_key,inclusion_source,display_order').eq('property_id', propertyId).in('planning_unit_id', unitIds).eq('active', true),
    supabase.from('shift_rule_sets').select('id,planning_unit_id,version,preset_key,engine_version,rules').eq('property_id', propertyId).in('planning_unit_id', unitIds),
    supabase.from('shifts').select('planning_unit_id,staff_profile_id,shift_date,locked,shift_codes!inner(code)').eq('property_id', propertyId).gte('shift_date', monthStart).lt('shift_date', nextMonthStart),
    supabase.from('shift_month_states').select('planning_unit_id,status').eq('property_id', propertyId).eq('month', monthStart),
    supabase.from('shift_unit_job_titles').select('planning_unit_id,job_title_id').eq('property_id', propertyId).in('planning_unit_id', unitIds),
  ])

  for (const result of [codesResult, membersResult, rulesResult, shiftsResult, monthStatesResult, unitJobTitlesResult]) {
    if (result.error) throw result.error
  }
  const unitJobTitles = (unitJobTitlesResult.data ?? []) as Row[]

  const codes = (codesResult.data ?? []) as Row[]
  const codeOrder = ['A1','A2','CE','C1','C2','N','D1','D2','F1','F2','R','F','P','P8','P7','P6','P5','P4','P3','P2','P1','R8','R7','R6','R5','R4','R3','R2','R1','RS','RR','AS','M','FG','CON','PL']
  const codeRank = new Map(codeOrder.map((code, index) => [code, index]))
  const members = (membersResult.data ?? []) as Row[]
  const ruleSets = (rulesResult.data ?? []) as Row[]
  const shifts = (shiftsResult.data ?? []) as Row[]
  const monthStates = (monthStatesResult.data ?? []) as Row[]
  const staffProfileIds = [...new Set(members.map((member) => String(member.staff_profile_id)))]
  const { data: staffProfilesData, error: staffProfilesError } = await supabase
    .from('shift_staff_profiles')
    .select('id,profile_id,shift_type,rest_mode,fixed_rest_days,active')
    .eq('property_id', propertyId)
    .in('id', staffProfileIds)
  if (staffProfilesError) throw staffProfilesError

  const staffProfiles = (staffProfilesData ?? []) as Row[]
  const profileIds = [...new Set(staffProfiles.map((staff) => String(staff.profile_id)))]
  const [profilesResult, staffDetailsResult] = await Promise.all([
    supabase.from('profiles').select('id,full_name').in('id', profileIds),
    supabase.from('property_staff_details').select('profile_id,job_title_id,property_job_titles(name)').eq('property_id', propertyId).in('profile_id', profileIds),
  ])
  if (profilesResult.error) throw profilesResult.error
  if (staffDetailsResult.error) throw staffDetailsResult.error

  const profiles = (profilesResult.data ?? []) as Row[]
  const staffDetails = (staffDetailsResult.data ?? []) as Row[]

  const assignmentDates = Array.from({ length: Math.round((nextMonth.getTime() - new Date(`${monthStart}T00:00:00Z`).getTime()) / 86400000) }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`)

  const projectedUnits: ShiftPlanningUnit[] = unitRows.map((unit) => {
    const unitMembers = members.filter((member) => member.planning_unit_id === unit.id).sort((a, b) => {
      const aOrder = typeof a.display_order === 'number' ? a.display_order : Number.MAX_SAFE_INTEGER
      const bOrder = typeof b.display_order === 'number' ? b.display_order : Number.MAX_SAFE_INTEGER
      if (aOrder !== bOrder) return aOrder - bOrder
      return String(a.staff_profile_id).localeCompare(String(b.staff_profile_id))
    })
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
      status: 'active',
      includedJobTitleIds: unitJobTitles.filter((row) => row.planning_unit_id === unit.id).map((row) => String(row.job_title_id)),
      ruleSetName: typeof activeRule?.preset_key === 'string' ? activeRule.preset_key : (typeof unit.name === 'string' ? unit.name : 'Unità'),
      ruleSetVersion: typeof activeRule?.version === 'number' ? activeRule.version : 1,
      ruleSetEngineVersion: typeof activeRule?.engine_version === 'string' ? activeRule.engine_version : 'v1',
      codes: codes.filter((code) => code.planning_unit_id === unit.id).sort((a, b) => (codeRank.get(String(a.code)) ?? 999) - (codeRank.get(String(b.code)) ?? 999)).map((code) => {
        const color = typeof code.color === 'string' ? code.color : '#9AA0A6'
        const startsAt = typeof code.starts_at === 'string' ? code.starts_at : null
        const endsAt = typeof code.ends_at === 'string' ? code.ends_at : null
        return {
          id: String(code.id),
          code: String(code.code),
          label: typeof code.label === 'string' ? code.label : String(code.code),
          time: timeLabel(startsAt, endsAt),
          startsAt,
          endsAt,
          kind: (typeof code.kind === 'string' ? code.kind : 'work') as 'work' | 'rest' | 'leave' | 'permission' | 'absence',
          color,
          textColor: contrastTextColor(color),
          active: code.active !== false,
        }
      }),
      people: unitMembers.filter((member) => {
        const staff = staffProfiles.find((candidate) => candidate.id === member.staff_profile_id)
        return staff?.active !== false
      }).map((member) => {
        const staff = staffProfiles.find((candidate) => candidate.id === member.staff_profile_id)
        const profile = profiles.find((candidate) => candidate.id === staff?.profile_id)
        const detail = staffDetails.find((candidate) => candidate.profile_id === staff?.profile_id)
        const jobTitle = related(detail?.property_job_titles)
        const title = typeof jobTitle?.name === 'string' ? jobTitle.name : undefined
        const name = typeof profile?.full_name === 'string' ? profile.full_name : 'Dipendente'
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
        restRotationPairsPerCycle: typeof rules.restRotationPairsPerCycle === 'number' ? rules.restRotationPairsPerCycle : undefined,
        roleCodes: rules.roleCodes && typeof rules.roleCodes === 'object' ? rules.roleCodes as Record<string, { base: string[]; extra: string[] }> : undefined,
      },
    }
  })

  return { property: { id: propertyId, name: propertyName, units: projectedUnits, jobTitleRoster }, month }
}

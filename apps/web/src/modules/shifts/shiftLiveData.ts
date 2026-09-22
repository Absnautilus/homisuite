import type { SupabaseClient } from '@supabase/supabase-js'
import type { ShiftPlanningUnit, ShiftPreviewProperty } from '@homisuite/shifts-module'

type Row = Record<string, any>

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

  const unitIds = units.map((unit: Row) => unit.id)
  const [
    codesResult,
    membersResult,
    rulesResult,
    shiftsResult,
  ] = await Promise.all([
    supabase.from('shift_codes').select('id,planning_unit_id,code,label,kind,starts_at,ends_at,color').eq('property_id', propertyId).in('planning_unit_id', unitIds).eq('active', true),
    supabase.from('shift_unit_members').select('id,planning_unit_id,staff_profile_id,assignment_profile_key,inclusion_source,shift_staff_profiles!inner(id,profile_id,shift_type,rest_mode,fixed_rest_days,active,profiles!inner(id,display_name),property_staff_details!inner(job_title_id,property_job_titles(name)))').eq('property_id', propertyId).in('planning_unit_id', unitIds).eq('active', true),
    supabase.from('shift_rule_sets').select('id,planning_unit_id,version,preset_key,rules').eq('property_id', propertyId).in('planning_unit_id', unitIds),
    supabase.from('shifts').select('planning_unit_id,staff_profile_id,shift_date,locked,shift_codes!inner(code)').eq('property_id', propertyId).gte('shift_date', monthStart).lt('shift_date', nextMonthStart),
  ])

  for (const result of [codesResult, membersResult, rulesResult, shiftsResult]) {
    if (result.error) throw result.error
  }

  const codes = (codesResult.data ?? []) as Row[]
  const members = (membersResult.data ?? []) as Row[]
  const ruleSets = (rulesResult.data ?? []) as Row[]
  const shifts = (shiftsResult.data ?? []) as Row[]

  const projectedUnits: ShiftPlanningUnit[] = (units as Row[]).map((unit) => {
    const unitMembers = members.filter((member) => member.planning_unit_id === unit.id)
    const activeRule = ruleSets.find((rule) => rule.id === unit.current_rule_set_id)
    const rules = activeRule?.rules ?? {}
    const assignments: Record<string, string[]> = {}

    for (const member of unitMembers) {
      assignments[member.staff_profile_id] = shifts
        .filter((shift) => shift.planning_unit_id === unit.id && shift.staff_profile_id === member.staff_profile_id)
        .sort((a, b) => String(a.shift_date).localeCompare(String(b.shift_date)))
        .map((shift) => shift.shift_codes?.code ?? 'R')
    }

    return {
      id: unit.id,
      name: unit.name,
      jobTitles: [],
      excludedJobTitles: [],
      ruleSetName: activeRule?.preset_key ?? unit.name,
      ruleSetVersion: activeRule?.version ?? 1,
      codes: codes.filter((code) => code.planning_unit_id === unit.id).map((code) => ({
        code: code.code,
        label: code.label,
        time: timeLabel(code.starts_at, code.ends_at),
        color: code.color,
      })),
      people: unitMembers.filter((member) => member.shift_staff_profiles?.active !== false).map((member) => {
        const staff = member.shift_staff_profiles
        const profile = staff?.profiles
        const detail = staff?.property_staff_details
        const title = Array.isArray(detail) ? detail[0]?.property_job_titles?.name : detail?.property_job_titles?.name
        const name = profile?.display_name ?? 'Dipendente'
        return {
          id: member.staff_profile_id,
          name,
          initials: initials(name),
          jobTitle: title ?? '—',
          assignmentProfile: assignmentProfile(member.assignment_profile_key ?? staff?.shift_type ?? 'day'),
          includedBy: member.inclusion_source === 'explicit_include' ? 'manual' : 'job-title',
          restMode: staff?.rest_mode === 'fixed' ? 'fixed' : 'rotating',
          restDays: staff?.rest_mode === 'fixed' ? restDays(staff.fixed_rest_days ?? []) : undefined,
        }
      }),
      assignments,
      rules: {
        coverage: Array.isArray(rules.coverage) ? rules.coverage.map(String) : [],
        hard: Array.isArray(rules.hard) ? rules.hard.map(String) : [],
        soft: Array.isArray(rules.soft) ? rules.soft.map(String) : [],
      },
    }
  })

  return { property: { id: propertyId, name: propertyName, units: projectedUnits }, month }
}

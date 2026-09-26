import type { SupabaseClient } from '@supabase/supabase-js'
import { computeMonthRestDays, DEFAULT_HARD_RULES, initRestRotationPairsPerCycle, initRuleEnabled, type RestRotationProfile, type ShiftPlanningUnit } from '@homisuite/shifts-module'
import { ensureRotationSlots, type StaffProfileRow } from './ensureRotationSlots'

/**
 * "Imposta riposi": assigns rest days ('R') for the visible month to every
 * rotating- and fixed-rest employee in the unit, per domain/restRotation.ts
 * (ported from Absnautilus/plannerturni). Never overwrites a day that
 * already has any shift -- rest never displaces an existing assignment,
 * manual or otherwise, matching the original app's own guard.
 */
export async function setUnitRestDays(
  supabase: SupabaseClient,
  propertyId: string,
  profileId: string,
  unit: ShiftPlanningUnit,
): Promise<Record<string, string[]>> {
  if (unit.monthStatus === 'final') throw new Error('Il mese è Definitivo: riporta il mese a Bozza per modificarlo.')
  if (!unit.month) throw new Error('Mese non disponibile per questa unità.')
  const [yearText, monthText] = unit.month.split('-')
  const year = Number(yearText)
  const month = Number(monthText) - 1 // 0-indexed, matching Date.UTC
  const daysInMonth = unit.assignmentDates?.length ?? new Date(Date.UTC(year, month + 1, 0)).getUTCDate()

  const memberIds = unit.people.map((person) => person.id)
  if (memberIds.length === 0) return {}

  const [{ data: unitStaff, error: unitStaffError }, { data: restCode, error: restCodeError }, { data: existingShifts, error: existingShiftsError }] = await Promise.all([
    supabase.from('shift_staff_profiles').select('id,shift_type,rest_mode,fixed_rest_days,rotation_slot').eq('property_id', propertyId).in('id', memberIds),
    supabase.from('shift_codes').select('id').eq('property_id', propertyId).eq('planning_unit_id', unit.id).eq('code', 'R').maybeSingle(),
    supabase.from('shifts').select('staff_profile_id,shift_date').eq('property_id', propertyId).eq('planning_unit_id', unit.id).gte('shift_date', `${unit.month}-01`).lt('shift_date', nextMonthStart(year, month)),
  ])
  if (unitStaffError) throw unitStaffError
  if (restCodeError) throw restCodeError
  if (existingShiftsError) throw existingShiftsError
  if (!restCode) throw new Error("Codice turno 'R' (Riposo) non configurato per questa unità.")

  const unitStaffRows = (unitStaff ?? []) as StaffProfileRow[]
  const newSlotByProfileId = await ensureRotationSlots(supabase, propertyId, unitStaffRows)

  const profiles: RestRotationProfile[] = unitStaffRows.map((staff) => ({
    id: staff.id,
    shiftType: staff.shift_type as RestRotationProfile['shiftType'],
    restMode: staff.rest_mode as RestRotationProfile['restMode'],
    fixedRestDays: staff.fixed_rest_days ?? [],
    rotationSlot: newSlotByProfileId.get(staff.id) ?? staff.rotation_slot,
  }))

  const turnanteFollowsNotturno = initRuleEnabled(DEFAULT_HARD_RULES, unit.rules.hard).riposoTurnanteDopoNotturno ?? true
  const pairsPerCycle = initRestRotationPairsPerCycle(unit.rules.restRotationPairsPerCycle)
  const restDaysByProfile = computeMonthRestDays(profiles, year, month, daysInMonth, turnanteFollowsNotturno, pairsPerCycle)

  const takenDates = new Set((existingShifts ?? []).map((row) => `${row.staff_profile_id}_${row.shift_date}`))
  const writtenByProfile: Record<string, string[]> = {}
  const rows = profiles.flatMap((profile) => {
    const dates = (restDaysByProfile[profile.id] ?? []).filter((date) => !takenDates.has(`${profile.id}_${date}`))
    if (dates.length > 0) writtenByProfile[profile.id] = dates
    return dates.map((date) => ({
      property_id: propertyId,
      planning_unit_id: unit.id,
      staff_profile_id: profile.id,
      shift_code_id: restCode.id,
      shift_date: date,
      source: 'automatic' as const,
      created_by: profileId,
    }))
  })
  if (rows.length === 0) return {}

  const { error: insertError } = await supabase.from('shifts').insert(rows)
  if (insertError) throw insertError
  return writtenByProfile
}

function nextMonthStart(year: number, month: number): string {
  const next = new Date(Date.UTC(year, month + 1, 1))
  return next.toISOString().slice(0, 10)
}

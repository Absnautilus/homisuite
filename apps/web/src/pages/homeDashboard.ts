import type { SupabaseClient } from '@supabase/supabase-js'

export interface TodayShift {
  code: string
  label: string | null
  startsAt: string | null
  endsAt: string | null
}

export interface UpcomingShiftDay {
  date: string
  code: string | null
}

export interface NextVacationPeriod {
  start: string
  end: string
  status: 'confirmed' | 'pending'
}

export interface HomeDashboardData {
  todayShift: TodayShift | null
  upcomingShifts: UpcomingShiftDay[]
  nextVacation: NextVacationPeriod | null
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Lightweight, read-only "at a glance" data for the Home page -- deliberately
 * NOT a reuse of shiftLiveData.ts, which loads every unit/person/month for
 * the whole Turni module: Home only ever needs the signed-in person's own
 * shift for today, the next few days, and their next vacation period.
 *
 * Returns null when Turni isn't enabled, or this account isn't staffed in
 * it at all (an owner/admin-only account, for instance) -- Home then simply
 * doesn't show the personalized row, rather than an empty/broken one.
 */
export async function loadHomeDashboard(supabase: SupabaseClient, propertyId: string): Promise<HomeDashboardData | null> {
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return null

  const { data: staffRow, error: staffError } = await supabase
    .from('shift_staff_profiles')
    .select('id')
    .eq('property_id', propertyId)
    .eq('profile_id', userId)
    .maybeSingle()
  if (staffError || !staffRow) return null
  const staffId = staffRow.id as string

  const today = new Date()
  const dates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today)
    date.setUTCDate(date.getUTCDate() + index)
    return isoDate(date)
  })
  const todayIso = dates[0]!

  const [shiftsResult, vacationResult] = await Promise.all([
    supabase
      .from('shifts')
      .select('shift_date, shift_codes(code, label, starts_at, ends_at)')
      .eq('property_id', propertyId)
      .eq('staff_profile_id', staffId)
      .gte('shift_date', todayIso)
      .lte('shift_date', dates[dates.length - 1]!),
    supabase
      .from('shift_vacation_periods')
      .select('start_date, end_date, status')
      .eq('property_id', propertyId)
      .eq('staff_profile_id', staffId)
      .gte('end_date', todayIso)
      .order('start_date', { ascending: true })
      .limit(1),
  ])

  type ShiftRow = { shift_date: string; shift_codes: { code: string; label: string | null; starts_at: string | null; ends_at: string | null } | { code: string; label: string | null; starts_at: string | null; ends_at: string | null }[] | null }
  const shiftRows = (shiftsResult.data ?? []) as ShiftRow[]
  const codeOf = (row: ShiftRow) => (Array.isArray(row.shift_codes) ? row.shift_codes[0] : row.shift_codes)
  const byDate = new Map(shiftRows.map((row) => [row.shift_date, codeOf(row)]))

  const todayCode = byDate.get(todayIso)
  const todayShift: TodayShift | null = todayCode
    ? { code: todayCode.code, label: todayCode.label, startsAt: todayCode.starts_at, endsAt: todayCode.ends_at }
    : null

  const upcomingShifts: UpcomingShiftDay[] = dates.map((date) => ({ date, code: byDate.get(date)?.code ?? null }))

  const vacationRow = (vacationResult.data ?? [])[0] as { start_date: string; end_date: string; status: string } | undefined
  const nextVacation: NextVacationPeriod | null = vacationRow
    ? { start: vacationRow.start_date, end: vacationRow.end_date, status: vacationRow.status === 'confirmed' ? 'confirmed' : 'pending' }
    : null

  return { todayShift, upcomingShifts, nextVacation }
}

import { useEffect, useState } from 'react'
import { Users } from 'lucide-react'
import { Avatar } from '@/components/avatar'
import { useLocale } from '@/lib/i18n/locale-context'
import { listRoster, subscribeToRoster } from '@/lib/staff-api'
import type { StaffProfile } from '@/lib/staff-types'
import type { StaffDepartment } from '@/lib/types'

const DEPARTMENTS: StaffDepartment[] = ['reception', 'housekeeping', 'maintenance']
const DEPARTMENT_KEY: Record<StaffDepartment, 'staff.roster.deptReception' | 'staff.roster.deptHousekeeping' | 'staff.roster.deptMaintenance'> = {
  reception: 'staff.roster.deptReception',
  housekeeping: 'staff.roster.deptHousekeeping',
  maintenance: 'staff.roster.deptMaintenance',
}
// A fourth, catch-all group -- someone active in the roster but with no
// resolved department (a platform-admin account, a profile missing its
// property_staff_details row, ...) used to just vanish from every group
// silently instead of showing up somewhere.
const OTHER = 'other' as const

// "Chi è in turno": the hotel's whole active roster, grouped by department,
// so anyone can see at a glance who's actually working right now -- not
// just whoever shows up as accepted_by/rejected_by on one request. Kept
// out of Modalità semplice by its one caller (request-queue.tsx), same as
// the rest of that view's extra chrome.
export function WhoOnDuty({ hotelId }: { hotelId: string }) {
  const { t } = useLocale()
  const [roster, setRoster] = useState<StaffProfile[] | null>(null)
  const [showOffline, setShowOffline] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await listRoster(hotelId)
        if (!cancelled) setRoster(data)
      } catch {
        // A failed load just leaves the panel empty -- this is a nice-to-have
        // visibility aid, not something worth surfacing an error banner for.
      }
    }
    void load()
    const unsubscribe = subscribeToRoster(hotelId, () => void load())
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [hotelId])

  if (!roster || roster.length === 0) return null

  const onDutyCount = roster.filter((person) => person.on_duty).length
  const byVisibility = (a: StaffProfile, b: StaffProfile) => Number(b.on_duty) - Number(a.on_duty) || a.name.localeCompare(b.name)
  const groups = [
    ...DEPARTMENTS.map((department) => ({
      key: department as StaffDepartment | typeof OTHER,
      labelKey: DEPARTMENT_KEY[department],
      people: roster.filter((person) => person.department === department && (person.on_duty || showOffline)).sort(byVisibility),
    })),
    {
      key: OTHER,
      labelKey: 'staff.roster.deptOther' as const,
      people: roster.filter((person) => !DEPARTMENTS.includes(person.department as StaffDepartment) && (person.on_duty || showOffline)).sort(byVisibility),
    },
  ].filter((group) => group.people.length > 0)

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5" data-tour="hk-who-on-duty">
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-accent" aria-hidden="true" />
          <h2 className="text-[13.5px] font-extrabold text-foreground">{t('staff.roster.title')}</h2>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-bg px-2.5 py-0.5 text-[11px] font-bold text-ok-ink">
            <span className="h-1.5 w-1.5 rounded-full bg-ok-ink" />
            {t('staff.roster.onDuty', { count: onDutyCount })}
          </span>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-muted">
          {t('staff.roster.showOffline')}
          <button
            type="button"
            role="switch"
            aria-checked={showOffline}
            onClick={() => setShowOffline((value) => !value)}
            className={`relative h-5 w-8.5 shrink-0 rounded-full transition-colors ${showOffline ? 'bg-accent' : 'bg-line-strong'}`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] ${showOffline ? 'left-4' : 'left-0.5'}`}
            />
          </button>
        </label>
      </div>
      <div className="flex flex-col gap-3.5">
        {groups.length === 0 && <p className="text-xs text-muted">{t('staff.roster.empty')}</p>}
        {groups.map((group) => (
          <div key={group.key}>
            <p className="mb-1.5 text-[10.5px] font-extrabold tracking-wide text-muted uppercase">{t(group.labelKey)}</p>
            <div className="flex flex-wrap gap-2">
              {group.people.map((person) => (
                <div
                  key={person.id}
                  title={`${person.name} · ${t(person.on_duty ? 'staff.roster.statusOnDuty' : 'staff.roster.statusOffDuty')}`}
                  className={`flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 ${person.on_duty ? 'border-line bg-surface' : 'border-line bg-surface-2 opacity-60'}`}
                >
                  <span className="relative">
                    <Avatar name={person.name} />
                    {person.on_duty && (
                      <span className="absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full border-2 border-surface bg-ok-ink" />
                    )}
                  </span>
                  <span className="text-xs font-bold text-foreground">{person.name.split(' ')[0]}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

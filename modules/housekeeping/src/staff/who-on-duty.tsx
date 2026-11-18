import { useEffect, useRef, useState } from 'react'
import { Users } from 'lucide-react'
import { Avatar } from '@/components/avatar'
import { SwitchControl } from '@/components/ui/switch'
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

const STACK_VISIBLE = 5

// "Chi è in turno": collapsed to a single stacked-avatar pill by default
// (the full grouped-by-department view took a whole section's worth of
// vertical space permanently) -- clicking it opens the same department
// breakdown in a popover instead. Kept out of Modalità semplice by its one
// caller (request-queue.tsx), same as the rest of that view's extra chrome.
export function WhoOnDuty({ hotelId }: { hotelId: string }) {
  const { t } = useLocale()
  const [roster, setRoster] = useState<StaffProfile[] | null>(null)
  const [showOffline, setShowOffline] = useState(false)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await listRoster(hotelId)
        if (!cancelled) setRoster(data)
      } catch {
        // A failed load just leaves the trigger showing 0 -- this is a
        // nice-to-have visibility aid, not worth an error banner.
      }
    }
    void load()
    const unsubscribe = subscribeToRoster(hotelId, () => void load())
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [hotelId])

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (!roster || roster.length === 0) return null

  const onDuty = roster.filter((person) => person.on_duty).sort((a, b) => a.name.localeCompare(b.name))
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

  const stackPeople = onDuty.slice(0, STACK_VISIBLE)
  const overflowCount = onDuty.length - stackPeople.length

  return (
    <div className="relative inline-block" ref={containerRef} data-tour="hk-who-on-duty">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={t('staff.roster.title')}
        className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-full border border-line bg-surface py-1 pr-3.5 pl-1.5 shadow-sm transition-colors hover:border-accent-soft-line"
      >
        {stackPeople.length > 0 ? (
          <span className="flex items-center">
            {stackPeople.map((person, index) => (
              <span key={person.id} className="relative shrink-0 rounded-full ring-2 ring-surface" style={index > 0 ? { marginLeft: -8 } : undefined}>
                <Avatar name={person.name} />
                <span className="absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full border-2 border-surface bg-ok-ink" />
              </span>
            ))}
            {overflowCount > 0 && (
              <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[0.6rem] font-bold text-muted ring-2 ring-surface" style={{ marginLeft: -8 }}>
                +{overflowCount}
              </span>
            )}
          </span>
        ) : (
          <Users className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
        )}
        <span className="text-xs font-bold text-foreground">{t('staff.roster.onDuty', { count: onDuty.length })}</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 z-20 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-line bg-surface p-4 shadow-lg sm:p-5">
          <div className="mb-3.5 flex items-center justify-between gap-3">
            <h2 className="text-[13.5px] font-extrabold text-foreground">{t('staff.roster.title')}</h2>
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-muted">
              {t('staff.roster.showOffline')}
              <SwitchControl checked={showOffline} onCheckedChange={setShowOffline} aria-label={t('staff.roster.showOffline')} />
            </label>
          </div>
          <div className="flex max-h-80 flex-col gap-3.5 overflow-y-auto">
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
        </div>
      )}
    </div>
  )
}

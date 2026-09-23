import { LockKeyhole } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { ShiftPlanningUnit } from '../preview/fixtures'
import { ShiftSelect } from './ShiftSelect'

interface ScheduleGridProps {
  unit: ShiftPlanningUnit
  view: 'month' | 'week'
  editable?: boolean
  onAssignmentChange?: (staffProfileId: string, date: string, code: string) => void
}

const WEEKDAY = new Intl.DateTimeFormat('it-IT', { weekday: 'short', timeZone: 'UTC' })

function fallbackDates(length: number) {
  return Array.from({ length }, (_, index) => `2026-09-${String(index + 1).padStart(2, '0')}`)
}

export function ScheduleGrid({ unit, view, editable = false, onAssignmentChange }: ScheduleGridProps) {
  const codeMap = new Map(unit.codes.map((code) => [code.code, code]))
  const dates = unit.assignmentDates?.length ? unit.assignmentDates : fallbackDates(view === 'week' ? 7 : 30)
  const visibleDates = view === 'week' ? dates.slice(0, 7) : dates

  return (
    <div className="shift-grid-scroll" tabIndex={0} aria-label={`Tabella turni ${unit.name}`}>
      <table className="shift-grid">
        <thead><tr><th className="shift-person-column">Dipendente</th>{visibleDates.map((date) => {
          const parsed = new Date(`${date}T00:00:00Z`)
          const weekend = [0, 6].includes(parsed.getUTCDay())
          return <th className={weekend ? 'is-weekend' : undefined} key={date}><strong>{parsed.getUTCDate()}</strong><span>{WEEKDAY.format(parsed).replace('.', '')}</span></th>
        })}</tr></thead>
        <tbody>{unit.people.map((person) => <tr key={person.id}>
          <th scope="row" className="shift-person-column"><span className="shift-avatar" aria-hidden="true">{person.initials}</span><span className="shift-person-copy"><strong>{person.name}</strong><small>{person.assignmentProfile}</small></span></th>
          {visibleDates.map((date) => {
            const sourceIndex = dates.indexOf(date)
            const code = unit.assignments[person.id]?.[sourceIndex] ?? ''
            const definition = codeMap.get(code)
            const locked = unit.lockedAssignments?.[person.id]?.includes(date) ?? false
            return <td key={`${person.id}-${date}`}>
              {editable && !locked ? <div className="shift-cell-editor"><ShiftSelect compact ariaLabel={`${person.name}, ${date}`} value={code} onChange={(next) => onAssignmentChange?.(person.id, date, next)} options={[{ value: '', label: 'Nessun turno', shortLabel: '' }, ...unit.codes.map((item) => ({ value: item.code, label: `${item.code} · ${item.label}${item.time ? ` (${item.time})` : ''}`, shortLabel: item.code, color: item.color, textColor: item.textColor }))]} /></div> : <div className={`shift-cell${code ? ' has-value' : ''}`} aria-label={`${person.name}, ${date}: ${definition?.label ?? (code || 'non assegnato')}`} title={`${definition?.label ?? code}${definition?.time ? ` · ${definition.time}` : ''}`} style={{ '--shift-color': definition?.color ?? '#9AA0A6', '--shift-text': definition?.textColor ?? '#fff' } as CSSProperties}>
                <strong>{code}</strong>{locked ? <LockKeyhole size={10} aria-label="Bloccato" /> : null}
              </div>}
            </td>
          })}
        </tr>)}</tbody>
      </table>
    </div>
  )
}

import { LockKeyhole } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'
import type { ShiftPlanningUnit } from '../preview/fixtures'
import { ShiftSelect } from './ShiftSelect'

interface ScheduleGridProps {
  unit: ShiftPlanningUnit
  view: 'month' | 'week'
  editable?: boolean
  onAssignmentChange?: (staffProfileId: string, date: string, code: string) => void
  onLockChange?: (staffProfileId: string, date: string, locked: boolean) => Promise<void>
}

const WEEKDAY = new Intl.DateTimeFormat('it-IT', { weekday: 'short', timeZone: 'UTC' })

function fallbackDates(length: number) {
  return Array.from({ length }, (_, index) => `2026-09-${String(index + 1).padStart(2, '0')}`)
}

export function ScheduleGrid({ unit, view, editable = false, onAssignmentChange, onLockChange }: ScheduleGridProps) {
  const [compactPeople, setCompactPeople] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches)
  const [expandedPeople, setExpandedPeople] = useState<Set<string>>(() => new Set())
  const [dnmEditor, setDnmEditor] = useState<string | null>(null)

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)')
    const sync = () => {
      setCompactPeople(media.matches)
      if (!media.matches) setExpandedPeople(new Set())
    }
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  function togglePerson(personId: string) {
    if (!compactPeople) return
    setExpandedPeople((current) => {
      const next = new Set(current)
      if (next.has(personId)) next.delete(personId)
      else next.add(personId)
      return next
    })
  }

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
          <th scope="row" className={`shift-person-column${compactPeople && !expandedPeople.has(person.id) ? ' is-compact' : ''}`}>
            <button
              type="button"
              className="shift-person-trigger"
              onClick={() => togglePerson(person.id)}
              aria-expanded={!compactPeople || expandedPeople.has(person.id)}
              aria-label={compactPeople ? `${expandedPeople.has(person.id) ? 'Riduci' : 'Mostra'} ${person.name}` : undefined}
              disabled={!compactPeople}
            >
              <span className="shift-avatar" aria-hidden="true">{person.initials}</span>
              {(!compactPeople || expandedPeople.has(person.id)) ? <span className="shift-person-copy"><strong>{person.name}</strong><small>{person.assignmentProfile}</small></span> : null}
            </button>
          </th>
          {visibleDates.map((date) => {
            const sourceIndex = dates.indexOf(date)
            const code = unit.assignments[person.id]?.[sourceIndex] ?? ''
            const definition = codeMap.get(code)
            const locked = unit.lockedAssignments?.[person.id]?.includes(date) ?? false
            const cellKey = `${person.id}:${date}`
            return <td key={`${person.id}-${date}`} onClick={() => { if (editable && code && !locked) setDnmEditor((current) => current === cellKey ? null : cellKey) }}>
              {editable && !locked ? <div className="shift-cell-editor"><ShiftSelect compact ariaLabel={`${person.name}, ${date}`} value={code} onChange={(next) => onAssignmentChange?.(person.id, date, next)} options={[{ value: '', label: 'Nessun turno', shortLabel: '' }, ...unit.codes.map((item) => ({ value: item.code, label: `${item.code} · ${item.label}${item.time ? ` (${item.time})` : ''}`, shortLabel: item.code, color: item.color, textColor: item.textColor }))]} />{code && onLockChange && dnmEditor === cellKey ? <button type="button" className="shift-lock-toggle is-offer" title="Non spostare questo turno" aria-label={`Blocca ${person.name}, ${date}`} onClick={(event) => { event.stopPropagation(); setDnmEditor(null); void onLockChange(person.id, date, true) }}><LockKeyhole size={8} /></button> : null}</div> : <div className={`shift-cell${code ? ' has-value' : ''}`} aria-label={`${person.name}, ${date}: ${definition?.label ?? (code || 'non assegnato')}`} title={`${definition?.label ?? code}${definition?.time ? ` · ${definition.time}` : ''}`} style={{ '--shift-color': definition?.color ?? '#9AA0A6', '--shift-text': definition?.textColor ?? '#fff' } as CSSProperties}>
                <strong>{code}</strong>{locked ? <button type="button" className="shift-lock-toggle is-locked" title={editable ? 'Consenti di nuovo lo spostamento' : 'Turno bloccato'} aria-label={editable ? `Sblocca ${person.name}, ${date}` : 'Bloccato'} disabled={!editable || !onLockChange} onClick={(event) => { event.stopPropagation(); void onLockChange?.(person.id, date, false) }}><LockKeyhole size={8} /></button> : null}
              </div>}
            </td>
          })}
        </tr>)}</tbody>
      </table>
    </div>
  )
}

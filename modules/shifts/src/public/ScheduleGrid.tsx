import { Lock } from 'lucide-react'
import { useEffect, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import type { ShiftPlanningUnit } from '../preview/fixtures'
import { ShiftSelect } from './ShiftSelect'

interface ScheduleGridProps {
  unit: ShiftPlanningUnit
  view: 'month' | 'week'
  editable?: boolean
  onAssignmentChange?: (staffProfileId: string, date: string, code: string) => void
  onLockChange?: (staffProfileId: string, date: string, locked: boolean) => Promise<void>
}

interface CellPos { personIdx: number; dateIdx: number }

const WEEKDAY = new Intl.DateTimeFormat('it-IT', { weekday: 'short', timeZone: 'UTC' })

function fallbackDates(length: number) {
  return Array.from({ length }, (_, index) => `2026-09-${String(index + 1).padStart(2, '0')}`)
}

function cellKey(personIdx: number, dateIdx: number) {
  return `${personIdx}:${dateIdx}`
}

function parseCellKey(key: string): CellPos {
  const [personIdx, dateIdx] = key.split(':')
  return { personIdx: Number(personIdx), dateIdx: Number(dateIdx) }
}

export function ScheduleGrid({ unit, view, editable = false, onAssignmentChange, onLockChange }: ScheduleGridProps) {
  const [compactPeople, setCompactPeople] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches)
  const [expandedPeople, setExpandedPeople] = useState<Set<string>>(() => new Set())
  // Shift-click adds exactly the clicked cell to the selection -- never a
  // filled rectangle between two distant clicks -- so several (possibly
  // scattered) cells can be re-assigned in one action instead of one dropdown
  // at a time. Ctrl/Cmd+C and +V copy the selected cells' codes and paste
  // them back (a single copied code "fills" every target cell; several
  // copied codes are replayed onto the target cells in the same top-to-
  // bottom, left-to-right order).
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set())
  const [clipboard, setClipboard] = useState<string[] | null>(null)

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

  // A view switch (or unit switch) changes which dates/people are visible at
  // all, so any row/column indices held in the selection would point at
  // different cells than the ones the user actually selected.
  useEffect(() => {
    setSelectedKeys(new Set())
  }, [view, unit.id])

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
  const people = unit.people

  const selectionSize = selectedKeys.size
  // The selection ring/tint only shows once there are 2+ cells in play --
  // a single plain click just opens that cell's own dropdown as always, so
  // marking it as "selected" too would only add a redundant ring around it.
  function isSelected(personIdx: number, dateIdx: number) {
    return selectionSize > 1 && selectedKeys.has(cellKey(personIdx, dateIdx))
  }

  function codeAt(personIdx: number, dateIdx: number): string {
    const person = people[personIdx]
    const date = visibleDates[dateIdx]
    if (!person || date == null) return ''
    const sourceIndex = dates.indexOf(date)
    return unit.assignments[person.id]?.[sourceIndex] ?? ''
  }

  function isLockedAt(personIdx: number, dateIdx: number): boolean {
    const person = people[personIdx]
    const date = visibleDates[dateIdx]
    if (!person || date == null) return false
    return unit.lockedAssignments?.[person.id]?.includes(date) ?? false
  }

  function handleCellClick(event: MouseEvent, personIdx: number, dateIdx: number) {
    if (!editable) return
    const key = cellKey(personIdx, dateIdx)
    if (event.shiftKey) {
      // Toggle exactly this cell in/out of the selection -- never fill in
      // everything between it and a previous click, however far apart they
      // are -- so this still has to block the cell's own dropdown from
      // opening while shift is held.
      event.preventDefault()
      event.stopPropagation()
      setSelectedKeys((current) => {
        const next = new Set(current)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
      return
    }
    setSelectedKeys(new Set([key]))
    // No stopPropagation here: a plain click still lets ShiftSelect's own
    // trigger open its dropdown exactly as before, so single-cell editing is
    // unchanged.
  }

  function orderedSelection(): CellPos[] {
    return Array.from(selectedKeys, parseCellKey).sort((a, b) => a.personIdx - b.personIdx || a.dateIdx - b.dateIdx)
  }

  function applyToSelection(code: string) {
    if (!onAssignmentChange || selectedKeys.size === 0) return
    for (const { personIdx, dateIdx } of orderedSelection()) {
      if (isLockedAt(personIdx, dateIdx)) continue
      const person = people[personIdx]
      const date = visibleDates[dateIdx]
      if (!person || date == null) continue
      onAssignmentChange(person.id, date, code)
    }
  }

  function copySelection() {
    if (selectedKeys.size === 0) return
    setClipboard(orderedSelection().map(({ personIdx, dateIdx }) => codeAt(personIdx, dateIdx)))
  }

  function pasteSelection() {
    if (!clipboard || !onAssignmentChange || selectedKeys.size === 0) return
    // A single copied cell fills every selected cell (spreadsheet "fill"
    // behavior); several copied cells are replayed onto the selected cells
    // in the same top-to-bottom, left-to-right order, wrapping if there are
    // more targets than copied codes.
    const fill = clipboard.length === 1
    orderedSelection().forEach(({ personIdx, dateIdx }, index) => {
      if (isLockedAt(personIdx, dateIdx)) return
      const person = people[personIdx]
      const date = visibleDates[dateIdx]
      if (!person || date == null) return
      const code = fill ? clipboard[0]! : clipboard[index % clipboard.length]!
      onAssignmentChange(person.id, date, code)
    })
  }

  function handleGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!editable) return
    if (event.key === 'Escape') {
      setSelectedKeys(new Set())
      return
    }
    const mod = event.ctrlKey || event.metaKey
    if (!mod || selectedKeys.size === 0) return
    const key = event.key.toLowerCase()
    if (key === 'c') {
      event.preventDefault()
      copySelection()
    } else if (key === 'v') {
      event.preventDefault()
      pasteSelection()
    }
  }

  return (
    <div className="shift-grid-scroll" tabIndex={0} aria-label={`Tabella turni ${unit.name}`} onKeyDown={handleGridKeyDown}>
      {editable && selectionSize > 1 ? <div className="shift-selection-bar" role="toolbar" aria-label="Azioni sulla selezione">
        <span>{selectionSize} celle selezionate</span>
        <div className="shift-selection-codes">
          <button type="button" onClick={() => applyToSelection('')}>Nessun turno</button>
          {unit.codes.map((item) => <button type="button" key={item.code} style={{ '--shift-color': item.color, '--shift-text': item.textColor ?? '#fff' } as CSSProperties} onClick={() => applyToSelection(item.code)}>{item.code}</button>)}
        </div>
        <span className="shift-selection-hint">Ctrl+C copia · Ctrl+V incolla · Esc deseleziona</span>
      </div> : null}
      <table className="shift-grid">
        <thead><tr><th className={`shift-person-column${compactPeople ? ' is-compact' : ''}`}>Dipendente</th>{visibleDates.map((date) => {
          const parsed = new Date(`${date}T00:00:00Z`)
          const weekend = [0, 6].includes(parsed.getUTCDay())
          return <th className={weekend ? 'is-weekend' : undefined} key={date}><strong>{parsed.getUTCDate()}</strong><span>{WEEKDAY.format(parsed).replace('.', '')}</span></th>
        })}</tr></thead>
        <tbody>{people.map((person, personIdx) => <tr key={person.id}>
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
          {visibleDates.map((date, dateIdx) => {
            const sourceIndex = dates.indexOf(date)
            const code = unit.assignments[person.id]?.[sourceIndex] ?? ''
            const definition = codeMap.get(code)
            const locked = unit.lockedAssignments?.[person.id]?.includes(date) ?? false
            const selected = isSelected(personIdx, dateIdx)
            return <td key={`${person.id}-${date}`} className={selected ? 'is-selected' : undefined} onClickCapture={(event) => handleCellClick(event, personIdx, dateIdx)}>
              {editable && !locked ? <div className={`shift-cell-editor${selected ? ' is-selected' : ''}`}><ShiftSelect compact ariaLabel={`${person.name}, ${date}`} value={code} onChange={(next) => onAssignmentChange?.(person.id, date, next)} extraAction={code && onLockChange ? { label: 'Non spostare (DNM)', icon: <Lock size={13} strokeWidth={2.25} />, onSelect: () => { void onLockChange(person.id, date, true) } } : undefined} options={[{ value: '', label: 'Nessun turno', shortLabel: '' }, ...unit.codes.map((item) => ({ value: item.code, label: `${item.code} · ${item.label}${item.time ? ` (${item.time})` : ''}`, shortLabel: item.code, color: item.color, textColor: item.textColor }))]} /></div> : <div className={`shift-cell${code ? ' has-value' : ''}${selected ? ' is-selected' : ''}`} aria-label={`${person.name}, ${date}: ${definition?.label ?? (code || 'non assegnato')}`} title={`${definition?.label ?? code}${definition?.time ? ` · ${definition.time}` : ''}`} style={{ '--shift-color': definition?.color ?? '#9AA0A6', '--shift-text': definition?.textColor ?? '#fff' } as CSSProperties}>
                <strong>{code}</strong>{locked ? <button type="button" className="shift-lock-toggle is-locked" title={editable ? 'Consenti di nuovo lo spostamento' : 'Turno bloccato'} aria-label={editable ? `Sblocca ${person.name}, ${date}` : 'Bloccato'} disabled={!editable || !onLockChange} onClick={(event) => { event.stopPropagation(); void onLockChange?.(person.id, date, false) }}><Lock size={9} strokeWidth={2.5} /></button> : null}
              </div>}
            </td>
          })}
        </tr>)}</tbody>
      </table>
    </div>
  )
}

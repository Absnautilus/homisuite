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
interface SelectionBounds { rMin: number; rMax: number; cMin: number; cMax: number }
interface ClipboardData { rows: number; cols: number; codes: string[][] }

const WEEKDAY = new Intl.DateTimeFormat('it-IT', { weekday: 'short', timeZone: 'UTC' })

function fallbackDates(length: number) {
  return Array.from({ length }, (_, index) => `2026-09-${String(index + 1).padStart(2, '0')}`)
}

export function ScheduleGrid({ unit, view, editable = false, onAssignmentChange, onLockChange }: ScheduleGridProps) {
  const [compactPeople, setCompactPeople] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches)
  const [expandedPeople, setExpandedPeople] = useState<Set<string>>(() => new Set())
  // Shift-click range selection, so several cells can be re-assigned in one
  // action instead of one dropdown at a time; Ctrl/Cmd+C and +V copy the
  // selected codes and paste them (as a block, or filled across a bigger
  // selection from a single copied cell) starting at the current selection's
  // top-left corner.
  const [selStart, setSelStart] = useState<CellPos | null>(null)
  const [selEnd, setSelEnd] = useState<CellPos | null>(null)
  const [clipboard, setClipboard] = useState<ClipboardData | null>(null)

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
    setSelStart(null)
    setSelEnd(null)
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

  function bounds(): SelectionBounds | null {
    if (!selStart || !selEnd) return null
    return {
      rMin: Math.min(selStart.personIdx, selEnd.personIdx),
      rMax: Math.max(selStart.personIdx, selEnd.personIdx),
      cMin: Math.min(selStart.dateIdx, selEnd.dateIdx),
      cMax: Math.max(selStart.dateIdx, selEnd.dateIdx),
    }
  }
  const selection = bounds()
  const selectionSize = selection ? (selection.rMax - selection.rMin + 1) * (selection.cMax - selection.cMin + 1) : 0

  function isSelected(personIdx: number, dateIdx: number) {
    if (!selection) return false
    return personIdx >= selection.rMin && personIdx <= selection.rMax && dateIdx >= selection.cMin && dateIdx <= selection.cMax
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
    if (event.shiftKey && selStart) {
      // Extend the existing selection instead of opening this cell's own
      // editor -- a shift-click means "add to the range", never "edit just
      // this one cell".
      event.preventDefault()
      event.stopPropagation()
      setSelEnd({ personIdx, dateIdx })
      return
    }
    setSelStart({ personIdx, dateIdx })
    setSelEnd({ personIdx, dateIdx })
    // No stopPropagation here: a plain click still lets ShiftSelect's own
    // trigger open its dropdown exactly as before, so single-cell editing is
    // unchanged.
  }

  function applyToSelection(code: string) {
    if (!selection || !onAssignmentChange) return
    for (let r = selection.rMin; r <= selection.rMax; r++) {
      for (let c = selection.cMin; c <= selection.cMax; c++) {
        if (isLockedAt(r, c)) continue
        const person = people[r]
        const date = visibleDates[c]
        if (!person || date == null) continue
        onAssignmentChange(person.id, date, code)
      }
    }
  }

  function copySelection() {
    if (!selection) return
    const rows = selection.rMax - selection.rMin + 1
    const cols = selection.cMax - selection.cMin + 1
    const codes: string[][] = []
    for (let r = 0; r < rows; r++) {
      const row: string[] = []
      for (let c = 0; c < cols; c++) row.push(codeAt(selection.rMin + r, selection.cMin + c))
      codes.push(row)
    }
    setClipboard({ rows, cols, codes })
  }

  function pasteSelection() {
    if (!clipboard || !selection || !onAssignmentChange) return
    // A single copied cell fills the whole current selection (spreadsheet
    // "fill" behavior); a copied block pastes at the selection's top-left,
    // clipped to the visible grid.
    const fill = clipboard.rows === 1 && clipboard.cols === 1
    const rows = fill ? selection.rMax - selection.rMin + 1 : clipboard.rows
    const cols = fill ? selection.cMax - selection.cMin + 1 : clipboard.cols
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const personIdx = selection.rMin + r
        const dateIdx = selection.cMin + c
        const person = people[personIdx]
        const date = visibleDates[dateIdx]
        if (!person || date == null) continue
        if (isLockedAt(personIdx, dateIdx)) continue
        const code = fill ? clipboard.codes[0]![0]! : clipboard.codes[r % clipboard.rows]![c % clipboard.cols]!
        onAssignmentChange(person.id, date, code)
      }
    }
  }

  function handleGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!editable) return
    if (event.key === 'Escape') {
      setSelStart(null)
      setSelEnd(null)
      return
    }
    const mod = event.ctrlKey || event.metaKey
    if (!mod || !selection) return
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

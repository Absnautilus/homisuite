import { Pin } from 'lucide-react'
import { useEffect, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import { Button, Modal } from '@homisuite/ui'
import type { ShiftPlanningUnit } from '../preview/fixtures'
import { ShiftSelect } from './ShiftSelect'

interface ScheduleGridProps {
  unit: ShiftPlanningUnit
  view: 'month' | 'week'
  editable?: boolean
  onAssignmentChange?: (changes: { staffProfileId: string; date: string; code: string }[]) => void
  onLockChange?: (staffProfileId: string, date: string, locked: boolean, note?: string | null) => Promise<void>
  /** Reverts the most recent not-yet-saved edit. Passed as undefined when
   * there's nothing staged locally, which is what lets Ctrl+Z fall through
   * (via bubbling, since it's then left un-intercepted) to the window-level
   * global undo instead -- see handleGridKeyDown. */
  onUndo?: () => void
  /** Highlights this person's own row -- see ShiftPlannerModule's own prop of the same name. */
  currentStaffProfileId?: string
}

interface CellPos { personIdx: number; dateIdx: number }

const ARROW_DELTAS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
}

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

export function ScheduleGrid({ unit, view, editable = false, onAssignmentChange, onLockChange, onUndo, currentStaffProfileId }: ScheduleGridProps) {
  // Compact (icon-only) by default on every screen size -- used to only
  // kick in below 760px, but a wide desktop grid with many date columns
  // benefits just as much from not spending ~235px per row on a name/role
  // that's rarely needed at a glance. One column can't render at two
  // different widths for different rows (a table column has a single
  // width, full stop), so this is a single on/off for the whole roster,
  // not a per-row toggle -- clicking any row's icon, or the "Dipendente"
  // header, widens or narrows every row together.
  const [peopleExpanded, setPeopleExpanded] = useState(false)
  // Shift-click adds exactly the clicked cell to the selection -- never a
  // filled rectangle between two distant clicks -- so several (possibly
  // scattered) cells can be re-assigned in one action instead of one dropdown
  // at a time. Ctrl/Cmd+C and +V copy the selected cells' codes and paste
  // them back (a single copied code "fills" every target cell; several
  // copied codes are replayed onto the target cells in the same top-to-
  // bottom, left-to-right order).
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set())
  const [clipboard, setClipboard] = useState<string[] | null>(null)
  // Click-and-drag rectangular range selection: mousedown on a cell records
  // the anchor; mouseenter on another cell while the button is still held
  // (checked via event.buttons, not component state -- the button can be
  // released outside the grid or even outside the window) extends the
  // rectangle from that anchor. No "is dragging" bookkeeping is needed to
  // keep a genuine drag from also opening the dropdown afterward: when
  // mousedown and mouseup land on different elements the browser never
  // fires a click on either, so handleCellClick's existing single-cell
  // open-dropdown path is simply never reached for a drag.
  const [dragAnchor, setDragAnchor] = useState<CellPos | null>(null)
  // The current arrow-key cursor, and the fixed corner a Shift+Arrow range
  // grows from -- a plain click/drag resets both to the clicked cell so an
  // unrelated earlier selection never leaks into the next Shift+Arrow.
  const [activeCell, setActiveCell] = useState<CellPos | null>(null)
  const [selectionAnchor, setSelectionAnchor] = useState<CellPos | null>(null)
  // The DNM (Non Movibile) dialog: creating it fresh from the ShiftSelect
  // menu action, or editing/removing it from the badge on an already-locked
  // cell -- one shared dialog for both, since they differ only in which
  // footer actions make sense and whether the note field starts blank.
  const [lockDialog, setLockDialog] = useState<{ personIdx: number; dateIdx: number; mode: 'create' | 'edit'; note: string } | null>(null)
  const [lockSaving, setLockSaving] = useState(false)

  // A view switch (or unit switch) changes which dates/people are visible at
  // all, so any row/column indices held in the selection would point at
  // different cells than the ones the user actually selected.
  useEffect(() => {
    setSelectedKeys(new Set())
    setDragAnchor(null)
    setActiveCell(null)
    setSelectionAnchor(null)
    setLockDialog(null)
  }, [view, unit.id])

  // The button can be released over any element, or outside the window
  // entirely -- only a window-level listener is guaranteed to see it.
  useEffect(() => {
    function handleWindowMouseUp() {
      setDragAnchor(null)
    }
    window.addEventListener('mouseup', handleWindowMouseUp)
    return () => window.removeEventListener('mouseup', handleWindowMouseUp)
  }, [])

  function togglePeople() {
    setPeopleExpanded((current) => !current)
  }

  const codeMap = new Map(unit.codes.map((code) => [code.code, code]))
  const dates = unit.assignmentDates?.length ? unit.assignmentDates : fallbackDates(view === 'week' ? 7 : 30)
  const visibleDates = view === 'week' ? dates.slice(0, 7) : dates
  const people = unit.people
  const todayIso = new Date().toISOString().slice(0, 10)

  const selectionSize = selectedKeys.size
  // The selection ring/tint only shows once there are 2+ cells in play --
  // a single plain click just opens that cell's own dropdown as always, so
  // marking it as "selected" too would only add a redundant ring around it.
  function isSelected(personIdx: number, dateIdx: number) {
    return selectionSize > 1 && selectedKeys.has(cellKey(personIdx, dateIdx))
  }

  function isActiveCell(personIdx: number, dateIdx: number) {
    return activeCell?.personIdx === personIdx && activeCell?.dateIdx === dateIdx
  }

  function rangeKeys(a: CellPos, b: CellPos): Set<string> {
    const [minP, maxP] = [Math.min(a.personIdx, b.personIdx), Math.max(a.personIdx, b.personIdx)]
    const [minD, maxD] = [Math.min(a.dateIdx, b.dateIdx), Math.max(a.dateIdx, b.dateIdx)]
    const keys = new Set<string>()
    for (let personIdx = minP; personIdx <= maxP; personIdx++) {
      for (let dateIdx = minD; dateIdx <= maxD; dateIdx++) keys.add(cellKey(personIdx, dateIdx))
    }
    return keys
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

  function lockNoteAt(personIdx: number, dateIdx: number): string {
    const person = people[personIdx]
    const date = visibleDates[dateIdx]
    if (!person || date == null) return ''
    return unit.lockedAssignmentNotes?.[person.id]?.[date] ?? ''
  }

  function openLockDialog(personIdx: number, dateIdx: number, mode: 'create' | 'edit') {
    setLockDialog({ personIdx, dateIdx, mode, note: mode === 'edit' ? lockNoteAt(personIdx, dateIdx) : '' })
  }

  async function confirmLockDialog() {
    if (!lockDialog || !onLockChange) return
    const person = people[lockDialog.personIdx]
    const date = visibleDates[lockDialog.dateIdx]
    if (!person || date == null) return
    setLockSaving(true)
    try {
      await onLockChange(person.id, date, true, lockDialog.note.trim() || null)
      setLockDialog(null)
    } finally {
      setLockSaving(false)
    }
  }

  async function removeLock() {
    if (!lockDialog || !onLockChange) return
    const person = people[lockDialog.personIdx]
    const date = visibleDates[lockDialog.dateIdx]
    if (!person || date == null) return
    setLockSaving(true)
    try {
      await onLockChange(person.id, date, false, null)
      setLockDialog(null)
    } finally {
      setLockSaving(false)
    }
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
      setActiveCell({ personIdx, dateIdx })
      return
    }
    // The mousedown that preceded this click already set selection/anchor/
    // active-cell to this same single cell (see handleCellMouseDown) -- this
    // branch only still exists so a plain click keeps opening the dropdown.
    // No stopPropagation here: a plain click still lets ShiftSelect's own
    // trigger open its dropdown exactly as before, so single-cell editing is
    // unchanged.
  }

  function handleCellMouseDown(event: MouseEvent, personIdx: number, dateIdx: number) {
    if (!editable || event.shiftKey || event.button !== 0) return
    const cell = { personIdx, dateIdx }
    setDragAnchor(cell)
    setActiveCell(cell)
    setSelectionAnchor(cell)
    setSelectedKeys(new Set([cellKey(personIdx, dateIdx)]))
  }

  function handleCellMouseEnter(event: MouseEvent, personIdx: number, dateIdx: number) {
    // event.buttons (not component state) is the source of truth for
    // whether the button is still down -- it can be released over an
    // element that never sees its own mouseup, or outside the window.
    if (!dragAnchor || !(event.buttons & 1)) return
    const cell = { personIdx, dateIdx }
    setActiveCell(cell)
    setSelectedKeys(rangeKeys(dragAnchor, cell))
  }

  function orderedSelection(): CellPos[] {
    return Array.from(selectedKeys, parseCellKey).sort((a, b) => a.personIdx - b.personIdx || a.dateIdx - b.dateIdx)
  }

  function applyToSelection(code: string) {
    if (!onAssignmentChange || selectedKeys.size === 0) return
    const changes: { staffProfileId: string; date: string; code: string }[] = []
    for (const { personIdx, dateIdx } of orderedSelection()) {
      if (isLockedAt(personIdx, dateIdx)) continue
      const person = people[personIdx]
      const date = visibleDates[dateIdx]
      if (!person || date == null) continue
      changes.push({ staffProfileId: person.id, date, code })
    }
    if (changes.length > 0) onAssignmentChange(changes)
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
    const changes: { staffProfileId: string; date: string; code: string }[] = []
    orderedSelection().forEach(({ personIdx, dateIdx }, index) => {
      if (isLockedAt(personIdx, dateIdx)) return
      const person = people[personIdx]
      const date = visibleDates[dateIdx]
      if (!person || date == null) return
      const code = fill ? clipboard[0]! : clipboard[index % clipboard.length]!
      changes.push({ staffProfileId: person.id, date, code })
    })
    if (changes.length > 0) onAssignmentChange(changes)
  }

  function handleArrowKey(event: KeyboardEvent<HTMLDivElement>) {
    const delta = ARROW_DELTAS[event.key]
    if (!delta || people.length === 0 || visibleDates.length === 0) return
    event.preventDefault()
    const base = activeCell ?? (selectedKeys.size === 1 ? parseCellKey(Array.from(selectedKeys)[0]!) : { personIdx: 0, dateIdx: 0 })
    const next = {
      personIdx: Math.min(Math.max(base.personIdx + delta[0], 0), people.length - 1),
      dateIdx: Math.min(Math.max(base.dateIdx + delta[1], 0), visibleDates.length - 1),
    }
    setActiveCell(next)
    if (event.shiftKey) {
      // Extends from the fixed anchor, not from `base` -- repeated
      // Shift+Arrow presses grow one rectangle instead of each press
      // re-anchoring from wherever the cursor just landed.
      const anchor = selectionAnchor ?? base
      setSelectionAnchor(anchor)
      setSelectedKeys(rangeKeys(anchor, next))
    } else {
      setSelectionAnchor(next)
      setSelectedKeys(new Set([cellKey(next.personIdx, next.dateIdx)]))
    }
  }

  function handleGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!editable) return
    if (event.key in ARROW_DELTAS) {
      handleArrowKey(event)
      return
    }
    if (event.key === 'Escape') {
      setSelectedKeys(new Set())
      return
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedKeys.size > 0) {
      event.preventDefault()
      applyToSelection('')
      return
    }
    const mod = event.ctrlKey || event.metaKey
    if (!mod) return
    const key = event.key.toLowerCase()
    if (key === 'z') {
      // Only intercepted when there's a staged local edit to undo (onUndo
      // is undefined otherwise) -- stopPropagation then keeps it from also
      // reaching the window-level global undo (the post-save one); leaving
      // it un-intercepted when there's nothing local lets that bubble up
      // to the global handler instead.
      if (onUndo) {
        event.preventDefault()
        event.stopPropagation()
        onUndo()
      }
      return
    }
    if (selectedKeys.size === 0) return
    if (key === 'c') {
      event.preventDefault()
      copySelection()
    } else if (key === 'v') {
      event.preventDefault()
      pasteSelection()
    }
  }

  return (
  <>
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
        <thead><tr><th className={`shift-person-column${peopleExpanded ? '' : ' is-compact'}`}>Dipendente</th>{visibleDates.map((date) => {
          const parsed = new Date(`${date}T00:00:00Z`)
          const weekend = [0, 6].includes(parsed.getUTCDay())
          const isToday = date === todayIso
          const headClass = [weekend ? 'is-weekend' : null, isToday ? 'is-today' : null].filter(Boolean).join(' ') || undefined
          return <th className={headClass} key={date}><strong>{parsed.getUTCDate()}</strong><span>{WEEKDAY.format(parsed).replace('.', '')}</span></th>
        })}</tr></thead>
        <tbody>{people.map((person, personIdx) => <tr key={person.id} className={person.id === currentStaffProfileId ? 'is-me' : undefined}>
          <th scope="row" className={`shift-person-column${peopleExpanded ? '' : ' is-compact'}`}>
            <button
              type="button"
              className="shift-person-trigger"
              onClick={togglePeople}
              aria-expanded={peopleExpanded}
              aria-label={`${peopleExpanded ? 'Riduci' : 'Mostra'} tutti i nomi (${person.name})`}
            >
              <span className="shift-avatar" aria-hidden="true">{person.initials}</span>
              {peopleExpanded ? <span className="shift-person-copy"><strong>{person.name}</strong><small>{person.assignmentProfile}</small></span> : null}
            </button>
          </th>
          {visibleDates.map((date, dateIdx) => {
            const sourceIndex = dates.indexOf(date)
            const code = unit.assignments[person.id]?.[sourceIndex] ?? ''
            const definition = codeMap.get(code)
            const locked = unit.lockedAssignments?.[person.id]?.includes(date) ?? false
            const selected = isSelected(personIdx, dateIdx)
            const active = isActiveCell(personIdx, dateIdx)
            const isToday = date === todayIso
            const cellStateClass = `${selected ? ' is-selected' : ''}${active ? ' is-active-cell' : ''}${isToday ? ' is-today' : ''}`
            const tdClass = [selected ? 'is-selected' : null, isToday ? 'is-today' : null].filter(Boolean).join(' ') || undefined
            return <td
              key={`${person.id}-${date}`}
              className={tdClass}
              onClickCapture={(event) => handleCellClick(event, personIdx, dateIdx)}
              onMouseDown={(event) => handleCellMouseDown(event, personIdx, dateIdx)}
              onMouseEnter={(event) => handleCellMouseEnter(event, personIdx, dateIdx)}
            >
              {editable && !locked ? <div className={`shift-cell-editor${cellStateClass}`}><ShiftSelect compact ariaLabel={`${person.name}, ${date}`} title={`${definition?.label ?? code}${definition?.time ? ` · ${definition.time}` : ''}`} value={code} onChange={(next) => onAssignmentChange?.([{ staffProfileId: person.id, date, code: next }])} extraAction={code && onLockChange ? { label: 'Non spostare (DNM)', icon: <Pin size={13} strokeWidth={2.25} />, onSelect: () => openLockDialog(personIdx, dateIdx, 'create') } : undefined} options={[{ value: '', label: 'Nessun turno', shortLabel: '' }, ...unit.codes.map((item) => ({ value: item.code, label: `${item.code} · ${item.label}${item.time ? ` (${item.time})` : ''}`, shortLabel: item.code, color: item.color, textColor: item.textColor }))]} /></div> : <div className={`shift-cell${code ? ' has-value' : ''}${cellStateClass}`} aria-label={`${person.name}, ${date}: ${definition?.label ?? (code || 'non assegnato')}`} title={`${definition?.label ?? code}${definition?.time ? ` · ${definition.time}` : ''}`} style={{ '--shift-color': definition?.color ?? '#9AA0A6', '--shift-text': definition?.textColor ?? '#fff' } as CSSProperties}>
                <strong>{code}</strong>{locked ? <button type="button" className="shift-dnm-badge" title={lockNoteAt(personIdx, dateIdx) ? `Non movibile: ${lockNoteAt(personIdx, dateIdx)}` : 'Non movibile (nessuna nota)'} aria-label={editable ? `Gestisci blocco DNM, ${person.name}, ${date}` : 'Turno non movibile'} disabled={!editable || !onLockChange} onClick={(event) => { event.stopPropagation(); openLockDialog(personIdx, dateIdx, 'edit') }}><Pin size={9} strokeWidth={2.5} /></button> : null}
              </div>}
            </td>
          })}
        </tr>)}</tbody>
      </table>
    </div>
    <Modal
      open={lockDialog !== null}
      title={lockDialog?.mode === 'edit' ? 'Non movibile (DNM)' : 'Blocca turno (DNM)'}
      description="Il turno non verrà toccato da riassegnazioni automatiche o da altre modifiche in blocco. La nota è facoltativa ed è visibile passando il cursore sul blocco."
      onClose={() => { if (!lockSaving) setLockDialog(null) }}
      dismissible={!lockSaving}
      footer={<>
        {lockDialog?.mode === 'edit' ? <Button variant="danger" size="sm" disabled={lockSaving} onClick={() => void removeLock()}>Rimuovi blocco</Button> : <Button variant="secondary" size="sm" disabled={lockSaving} onClick={() => setLockDialog(null)}>Annulla</Button>}
        <Button variant="primary" size="sm" loading={lockSaving} onClick={() => void confirmLockDialog()}>{lockDialog?.mode === 'edit' ? 'Salva nota' : 'Blocca'}</Button>
      </>}
    >
      <label className="shift-dnm-note-field">
        <span>Nota (facoltativa)</span>
        <textarea
          rows={3}
          value={lockDialog?.note ?? ''}
          onChange={(event) => setLockDialog((current) => current ? { ...current, note: event.target.value } : current)}
          placeholder="Es. richiesta del cliente, manutenzione, evento…"
          autoFocus
        />
      </label>
    </Modal>
  </>
  )
}

import { useRef, useState, type FormEvent, type RefObject } from 'react'
import { Modal } from '@homisuite/ui'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import type { ShiftCode, ShiftPlanningUnit } from '../preview/fixtures'
import { contrastTextColor } from '../domain/contrastColor'
import { ShiftSelect } from './ShiftSelect'

export interface ShiftCodeSave {
  id?: string
  planningUnitId: string
  code: string
  label: string
  kind: 'work' | 'rest' | 'leave' | 'permission' | 'absence'
  startsAt: string | null
  endsAt: string | null
  color: string
  textColor: '#111111' | '#ffffff'
}

const KIND_OPTIONS: Array<{ value: ShiftCodeSave['kind']; label: string }> = [
  { value: 'work', label: 'Lavoro' },
  { value: 'rest', label: 'Riposo' },
  { value: 'leave', label: 'Ferie' },
  { value: 'permission', label: 'Permesso' },
  { value: 'absence', label: 'Assenza' },
]
const KIND_LABEL_BY_VALUE = new Map(KIND_OPTIONS.map((option) => [option.value, option.label]))
const DEFAULT_CODE_COLOR = '#9AA0A6'
const HEX_RE = /^#[0-9a-fA-F]{6}$/

export function CodesPanel({ unit, onSaveCode, onDeleteCode }: {
  unit: ShiftPlanningUnit
  onSaveCode?: (input: ShiftCodeSave) => Promise<void>
  onDeleteCode?: (codeId: string) => Promise<'deleted' | 'archived'>
}) {
  const [editing, setEditing] = useState<ShiftCode | 'new' | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [result, setResult] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  // Points at whichever button (a row's pencil/trash, or "Aggiungi codice")
  // was clicked most recently, so the modal that follows can morph out of it.
  const triggerRef = useRef<HTMLElement | null>(null)

  function openEditor(event: { currentTarget: HTMLElement }, code: ShiftCode | 'new') {
    triggerRef.current = event.currentTarget
    setEditing(code)
  }

  async function handleDelete(event: { currentTarget: HTMLElement }, code: ShiftCode) {
    if (!onDeleteCode || !code.id || deletingId) return
    triggerRef.current = event.currentTarget
    setDeletingId(code.id)
    try {
      const outcome = await onDeleteCode(code.id)
      setResult({
        kind: 'success',
        message: outcome === 'archived'
          ? `"${code.code}" è già stato usato in alcuni turni: archiviato invece di eliminato.`
          : `"${code.code}" eliminato.`,
      })
    } catch {
      setResult({ kind: 'error', message: 'Impossibile eliminare il codice. Riprova.' })
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <section className="shift-panel shift-codes-panel">
      <div className="shift-panel-title">
        <div><h2>Codici turno</h2><p>Sigla, orario e colore badge per {unit.name}. Un codice già usato in qualche turno viene archiviato invece che eliminato.</p></div>
        {onSaveCode ? <button type="button" className="shift-original-primary shift-codes-add" onClick={(event) => openEditor(event, 'new')}><Plus size={14} />Aggiungi codice</button> : null}
      </div>
      <div className="shift-table-scroll" tabIndex={0} aria-label={`Codici turno di ${unit.name}`}>
        <table className="shift-codes-table">
          <thead><tr><th>Sigla</th><th>Nome</th><th>Tipo</th><th>Orario</th><th>Badge</th><th>Stato</th>{onSaveCode ? <th>Azioni</th> : null}</tr></thead>
          <tbody>{unit.codes.map((code) => {
            const background = HEX_RE.test(code.color) ? code.color : DEFAULT_CODE_COLOR
            return (
              <tr key={code.id ?? code.code} className={code.active === false ? 'is-archived' : undefined}>
                <td><strong>{code.code}</strong></td>
                <td>{code.label}</td>
                <td>{KIND_LABEL_BY_VALUE.get(code.kind ?? 'work') ?? '—'}</td>
                <td>{code.time || '—'}</td>
                <td><span className="shift-code-badge-preview" style={{ background, color: code.textColor ?? contrastTextColor(background) }}>{code.code}</span></td>
                <td>{code.active === false ? 'Archiviato' : 'Attivo'}</td>
                {onSaveCode ? (
                  <td className="shift-codes-actions">
                    <button type="button" className="shift-code-action" aria-label={`Modifica ${code.label}`} onClick={(event) => openEditor(event, code)}><Pencil size={14} /></button>
                    {onDeleteCode && code.id && code.active !== false ? (
                      <button type="button" className="shift-code-action is-danger" aria-label={`Elimina ${code.label}`} disabled={deletingId === code.id} onClick={(event) => void handleDelete(event, code)}><Trash2 size={14} /></button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            )
          })}</tbody>
        </table>
      </div>
      {editing ? (
        <CodeForm
          unit={unit}
          initial={editing === 'new' ? null : editing}
          originRef={triggerRef}
          onSave={onSaveCode}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <Modal
        open={result !== null}
        originRef={triggerRef}
        title={result?.kind === 'error' ? 'Errore' : 'Fatto'}
        onClose={() => setResult(null)}
        footer={<button type="button" className="shift-original-primary" onClick={() => setResult(null)}>Chiudi</button>}
      >
        <p role={result?.kind === 'error' ? 'alert' : 'status'}>{result?.message}</p>
      </Modal>
    </section>
  )
}

function CodeForm({ unit, initial, originRef, onSave, onClose }: {
  unit: ShiftPlanningUnit
  initial: ShiftCode | null
  originRef: RefObject<HTMLElement | null>
  onSave?: (input: ShiftCodeSave) => Promise<void>
  onClose: () => void
}) {
  const [code, setCode] = useState(initial?.code ?? '')
  const [label, setLabel] = useState(initial?.label ?? '')
  const [kind, setKind] = useState<ShiftCodeSave['kind']>(initial?.kind ?? 'work')
  const [startsAt, setStartsAt] = useState(initial?.startsAt ?? '')
  const [endsAt, setEndsAt] = useState(initial?.endsAt ?? '')
  const [color, setColor] = useState(HEX_RE.test(initial?.color ?? '') ? initial!.color : DEFAULT_CODE_COLOR)
  const [textColor, setTextColor] = useState<'#111111' | '#ffffff'>(
    initial?.textColor === '#ffffff' || initial?.textColor === '#111111' ? initial.textColor : contrastTextColor(HEX_RE.test(initial?.color ?? '') ? initial!.color : DEFAULT_CODE_COLOR),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isWork = kind === 'work'
  const swatch = HEX_RE.test(color) ? color : DEFAULT_CODE_COLOR

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!onSave) return
    if (isWork && (!startsAt || !endsAt)) {
      setError('Indica orario di inizio e fine per un codice di lavoro.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave({
        id: initial?.id,
        planningUnitId: unit.id,
        code: code.trim().toUpperCase(),
        label: label.trim(),
        kind,
        startsAt: isWork ? startsAt : null,
        endsAt: isWork ? endsAt : null,
        color: swatch,
        textColor,
      })
      onClose()
    } catch {
      setError('Impossibile salvare il codice. Riprova.')
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      originRef={originRef}
      title={initial ? `Modifica ${initial.label || initial.code}` : 'Aggiungi codice'}
      description={`Codice turno per ${unit.name}.`}
      onClose={onClose}
      dismissible={!saving}
      footer={<>
        <button type="button" className="shift-code-form-cancel" disabled={saving} onClick={onClose}>Annulla</button>
        <button type="submit" form="shift-code-form" className="shift-original-primary" disabled={saving}>{saving ? 'Salvataggio…' : 'Salva'}</button>
      </>}
    >
      <form className="shift-code-form" id="shift-code-form" onSubmit={submit}>
        <div className="shift-code-form-grid">
          <label>Sigla<input value={code} maxLength={12} required disabled={saving} onChange={(event) => setCode(event.target.value)} placeholder="es. C1" /></label>
          <label>Nome<input value={label} maxLength={80} required disabled={saving} onChange={(event) => setLabel(event.target.value)} placeholder="es. Chiusura 1" /></label>
          <label>Tipo<ShiftSelect ariaLabel="Tipo di codice turno" value={kind} disabled={saving} onChange={(value) => setKind(value as ShiftCodeSave['kind'])} options={KIND_OPTIONS} /></label>
          {isWork ? (
            <>
              <label>Inizio<input type="time" value={startsAt} required disabled={saving} onChange={(event) => setStartsAt(event.target.value)} /></label>
              <label>Fine<input type="time" value={endsAt} required disabled={saving} onChange={(event) => setEndsAt(event.target.value)} /></label>
            </>
          ) : null}
          <label className="shift-code-color-field">
            Colore badge
            <span className="shift-code-color-row">
              <input type="color" value={swatch} disabled={saving} onChange={(event) => setColor(event.target.value)} aria-label="Colore badge" />
              <input type="text" value={color} maxLength={7} spellCheck={false} disabled={saving} onChange={(event) => setColor(event.target.value)} />
              <span className="shift-code-badge-preview" style={{ background: swatch, color: textColor }}>{code.trim() || '—'}</span>
            </span>
          </label>
          <div className="shift-code-textcolor-field">
            Testo badge
            <div className="shift-code-textcolor-options" role="radiogroup" aria-label="Colore del testo nel badge">
              <button type="button" role="radio" aria-checked={textColor === '#ffffff'} className={`shift-code-textcolor-option${textColor === '#ffffff' ? ' is-selected' : ''}`} disabled={saving} onClick={() => setTextColor('#ffffff')}>Bianco</button>
              <button type="button" role="radio" aria-checked={textColor === '#111111'} className={`shift-code-textcolor-option${textColor === '#111111' ? ' is-selected' : ''}`} disabled={saving} onClick={() => setTextColor('#111111')}>Nero</button>
            </div>
          </div>
        </div>
        {error ? <p role="alert" className="shift-code-form-error">{error}</p> : null}
      </form>
    </Modal>
  )
}

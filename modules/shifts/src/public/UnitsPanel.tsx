import { useState, type FormEvent } from 'react'
import { Archive, Pencil, Plus } from 'lucide-react'
import type { ShiftJobTitle, ShiftPlanningUnit } from '../preview/fixtures'

export interface UnitSave {
  id?: string
  name: string
  includedJobTitleIds: string[]
}

export interface UnitSaveResult {
  id: string
  name: string
  includedJobTitleIds: string[]
  status: 'active' | 'inactive'
}

export function UnitsPanel({ units, jobTitleRoster, onSaveUnit, onArchiveUnit }: {
  units: ShiftPlanningUnit[]
  jobTitleRoster: ShiftJobTitle[]
  onSaveUnit?: (input: UnitSave) => Promise<UnitSaveResult>
  onArchiveUnit?: (unitId: string) => Promise<void>
}) {
  const [editing, setEditing] = useState<ShiftPlanningUnit | 'new' | null>(null)
  const [archivingId, setArchivingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  async function handleArchive(unit: ShiftPlanningUnit) {
    if (!onArchiveUnit || archivingId || unit.status === 'inactive') return
    setArchivingId(unit.id)
    setError(null)
    setFeedback(null)
    try {
      await onArchiveUnit(unit.id)
      setFeedback(`"${unit.name}" archiviata.`)
    } catch {
      setError("Impossibile archiviare l'unità. Riprova.")
    } finally {
      setArchivingId(null)
    }
  }

  return (
    <section className="shift-panel shift-units-panel">
      <div className="shift-panel-title">
        <div><h2>Unità</h2><p>Le unità di pianificazione della struttura (Reception, Booking, Housekeeping…) e le mansioni che vi rientrano automaticamente.</p></div>
        {onSaveUnit ? <button type="button" className="shift-original-primary shift-codes-add" onClick={() => setEditing('new')}><Plus size={14} />Nuova unità</button> : null}
      </div>
      {feedback ? <div className="shift-empty" role="status">{feedback}</div> : null}
      {error ? <div className="shift-empty" role="alert">{error}</div> : null}
      <div className="shift-table-scroll" tabIndex={0} aria-label="Unità di pianificazione">
        <table className="shift-codes-table">
          <thead><tr><th>Nome</th><th>Mansioni incluse</th><th>Persone</th><th>Stato</th>{onSaveUnit ? <th>Azioni</th> : null}</tr></thead>
          <tbody>{units.map((unit) => {
            const names = unit.includedJobTitleIds
              .map((id) => jobTitleRoster.find((jobTitle) => jobTitle.id === id)?.name)
              .filter((name): name is string => Boolean(name))
            return (
              <tr key={unit.id} className={unit.status === 'inactive' ? 'is-archived' : undefined}>
                <td><strong>{unit.name}</strong></td>
                <td>{names.length > 0 ? names.join(', ') : '—'}</td>
                <td>{unit.people.length}</td>
                <td>{unit.status === 'inactive' ? 'Archiviata' : 'Attiva'}</td>
                {onSaveUnit ? (
                  <td className="shift-codes-actions">
                    <button type="button" className="shift-code-action" aria-label={`Modifica ${unit.name}`} onClick={() => setEditing(unit)}><Pencil size={14} /></button>
                    {onArchiveUnit && unit.status !== 'inactive' ? (
                      <button type="button" className="shift-code-action is-danger" aria-label={`Archivia ${unit.name}`} disabled={archivingId === unit.id} onClick={() => void handleArchive(unit)}><Archive size={14} /></button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            )
          })}</tbody>
        </table>
      </div>
      {editing ? (
        <UnitForm
          jobTitleRoster={jobTitleRoster}
          initial={editing === 'new' ? null : editing}
          onSave={onSaveUnit}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  )
}

function UnitForm({ jobTitleRoster, initial, onSave, onClose }: {
  jobTitleRoster: ShiftJobTitle[]
  initial: ShiftPlanningUnit | null
  onSave?: (input: UnitSave) => Promise<UnitSaveResult>
  onClose: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [selectedIds, setSelectedIds] = useState<string[]>(initial?.includedJobTitleIds ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleJobTitle(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id])
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!onSave) return
    setSaving(true)
    setError(null)
    try {
      await onSave({ id: initial?.id, name: name.trim(), includedJobTitleIds: selectedIds })
      onClose()
    } catch {
      setError("Impossibile salvare l'unità. Riprova.")
      setSaving(false)
    }
  }

  return (
    <form className="shift-code-form shift-unit-form" onSubmit={submit}>
      <label className="shift-unit-name-field">
        Nome unità
        <input value={name} maxLength={80} required disabled={saving} onChange={(event) => setName(event.target.value)} placeholder="es. Booking" />
      </label>
      <div className="shift-unit-job-titles">
        <span className="shift-unit-job-titles-label">Mansioni incluse automaticamente</span>
        {jobTitleRoster.length === 0 ? <p className="shift-form-help">Nessuna mansione configurata in Team per questa struttura.</p> : (
          <div className="shift-unit-job-titles-grid">{jobTitleRoster.map((jobTitle) => (
            <label key={jobTitle.id} className="shift-unit-job-title-option">
              <input type="checkbox" checked={selectedIds.includes(jobTitle.id)} disabled={saving} onChange={() => toggleJobTitle(jobTitle.id)} />
              {jobTitle.name}
            </label>
          ))}</div>
        )}
      </div>
      {error ? <p role="alert" className="shift-code-form-error">{error}</p> : null}
      <div className="shift-code-form-actions">
        <button type="button" className="shift-code-form-cancel" disabled={saving} onClick={onClose}>Annulla</button>
        <button type="submit" className="shift-original-primary" disabled={saving || !name.trim()}>{saving ? 'Salvataggio…' : 'Salva'}</button>
      </div>
    </form>
  )
}

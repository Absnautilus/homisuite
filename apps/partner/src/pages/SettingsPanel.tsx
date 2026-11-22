import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button, DatePicker, TimePicker } from '@homisuite/ui'
import { Plus, Trash2 } from 'lucide-react'
import { addBlackoutDate, deleteBlackoutDate, listMyBlackoutDates, listMyHours, setMyHours, updateCapacity } from '../api'
import { DAY_LABELS } from '../types'
import type { PartnerBlackoutDate, PartnerCapacity, PartnerHours } from '../types'

interface SettingsPanelProps {
  servicePartnerId: string
  initialCapacity: PartnerCapacity
  onCapacitySaved: (capacity: PartnerCapacity) => void
}

export function SettingsPanel({ servicePartnerId, initialCapacity, onCapacitySaved }: SettingsPanelProps) {
  const [seatsIndoor, setSeatsIndoor] = useState(initialCapacity.seatsIndoor?.toString() ?? '')
  const [seatsOutdoor, setSeatsOutdoor] = useState(initialCapacity.seatsOutdoor?.toString() ?? '')
  const [availabilityNotes, setAvailabilityNotes] = useState(initialCapacity.availabilityNotes ?? '')
  const [savingCapacity, setSavingCapacity] = useState(false)
  const [capacitySaved, setCapacitySaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [hours, setHours] = useState<PartnerHours[] | null>(null)
  const [savingHours, setSavingHours] = useState(false)

  const [blackoutDates, setBlackoutDates] = useState<PartnerBlackoutDate[] | null>(null)
  const [newBlackoutDate, setNewBlackoutDate] = useState('')
  const [newBlackoutNote, setNewBlackoutNote] = useState('')

  const loadExtras = useCallback(async () => {
    try {
      const [h, b] = await Promise.all([listMyHours(), listMyBlackoutDates()])
      setHours(h)
      setBlackoutDates(b)
    } catch {
      setError('Non è stato possibile caricare orari e date non disponibili.')
    }
  }, [])

  useEffect(() => { void loadExtras() }, [loadExtras])

  async function saveCapacity(event: FormEvent) {
    event.preventDefault()
    setSavingCapacity(true)
    setError(null)
    setCapacitySaved(false)
    try {
      const capacity: PartnerCapacity = {
        seatsIndoor: seatsIndoor.trim() ? Number(seatsIndoor) : null,
        seatsOutdoor: seatsOutdoor.trim() ? Number(seatsOutdoor) : null,
        availabilityNotes: availabilityNotes.trim() || null,
      }
      await updateCapacity(capacity)
      onCapacitySaved(capacity)
      setCapacitySaved(true)
    } catch {
      setError('Non è stato possibile salvare. Riprova.')
    } finally {
      setSavingCapacity(false)
    }
  }

  // A day with no hours row just means "chiuso" -- toggling it on seeds a
  // sensible default range the partner then adjusts, rather than forcing
  // them to type both times just to mark a day open.
  function toggleDay(day: number) {
    setHours((current) => {
      if (!current) return current
      if (current.some((h) => h.dayOfWeek === day)) return current.filter((h) => h.dayOfWeek !== day)
      return [...current, { id: `new-${day}`, dayOfWeek: day, opensAt: '12:00', closesAt: '22:00' }].sort((a, b) => a.dayOfWeek - b.dayOfWeek)
    })
  }

  function updateDayTime(day: number, field: 'opensAt' | 'closesAt', value: string) {
    setHours((current) => current ? current.map((h) => (h.dayOfWeek === day ? { ...h, [field]: value } : h)) : current)
  }

  async function saveHours() {
    if (!hours) return
    setSavingHours(true)
    setError(null)
    try {
      await setMyHours(servicePartnerId, hours.map((h) => ({ dayOfWeek: h.dayOfWeek, opensAt: h.opensAt, closesAt: h.closesAt })))
      await loadExtras()
    } catch {
      setError('Non è stato possibile salvare gli orari. Riprova.')
    } finally {
      setSavingHours(false)
    }
  }

  async function submitBlackout(event: FormEvent) {
    event.preventDefault()
    if (!newBlackoutDate) return
    setError(null)
    try {
      await addBlackoutDate(servicePartnerId, newBlackoutDate, newBlackoutNote.trim() || null)
      setNewBlackoutDate('')
      setNewBlackoutNote('')
      await loadExtras()
    } catch {
      setError('Non è stato possibile aggiungere la data. Riprova.')
    }
  }

  async function removeBlackout(id: string) {
    setError(null)
    try {
      await deleteBlackoutDate(id)
      await loadExtras()
    } catch {
      setError('Non è stato possibile rimuovere la data. Riprova.')
    }
  }

  return (
    <div className="partner-settings-grid">
      {error ? <p className="login-error" role="alert">{error}</p> : null}

      <section className="partner-settings-section">
        <h2>Capienza</h2>
        <form onSubmit={(event) => void saveCapacity(event)} style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label className="partner-field">
              <span>Posti dentro</span>
              <input type="number" min={0} value={seatsIndoor} onChange={(event) => setSeatsIndoor(event.target.value)} />
            </label>
            <label className="partner-field">
              <span>Posti fuori</span>
              <input type="number" min={0} value={seatsOutdoor} onChange={(event) => setSeatsOutdoor(event.target.value)} />
            </label>
          </div>
          <label className="partner-field">
            <span>Note di disponibilità</span>
            <textarea rows={2} placeholder="Es. chiuso il lunedì, tutto prenotato sabato sera…" value={availabilityNotes} onChange={(event) => setAvailabilityNotes(event.target.value)} />
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Button type="submit" disabled={savingCapacity}>{savingCapacity ? 'Salvataggio…' : 'Salva'}</Button>
            {capacitySaved ? <span className="muted" style={{ fontSize: 13 }}>Salvato.</span> : null}
          </div>
        </form>
      </section>

      <section className="partner-settings-section">
        <h2>Orari di apertura</h2>
        {hours === null ? (
          <p className="muted">Caricamento…</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {DAY_LABELS.map((label, day) => {
              const entry = hours.find((h) => h.dayOfWeek === day)
              return (
                <div key={day} className="partner-hours-row">
                  <label className="partner-hours-toggle">
                    <input type="checkbox" checked={Boolean(entry)} onChange={() => toggleDay(day)} />
                    <span>{label}</span>
                  </label>
                  {entry ? (
                    <div className="partner-hours-times">
                      <TimePicker ariaLabel={`Apertura ${label}`} value={entry.opensAt.slice(0, 5)} onChange={(value) => updateDayTime(day, 'opensAt', value)} />
                      <span>–</span>
                      <TimePicker ariaLabel={`Chiusura ${label}`} value={entry.closesAt.slice(0, 5)} onChange={(value) => updateDayTime(day, 'closesAt', value)} />
                    </div>
                  ) : <span className="muted" style={{ fontSize: 13 }}>Chiuso</span>}
                </div>
              )
            })}
            <div>
              <Button onClick={() => void saveHours()} disabled={savingHours}>{savingHours ? 'Salvataggio…' : 'Salva orari'}</Button>
            </div>
          </div>
        )}
      </section>

      <section className="partner-settings-section">
        <h2>Date non disponibili</h2>
        <form onSubmit={(event) => void submitBlackout(event)} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="partner-field">
            <span>Data</span>
            <DatePicker ariaLabel="Data non disponibile" value={newBlackoutDate} onChange={setNewBlackoutDate} />
          </label>
          <label className="partner-field" style={{ flex: 1, minWidth: 160 }}>
            <span>Nota (facoltativa)</span>
            <input value={newBlackoutNote} onChange={(event) => setNewBlackoutNote(event.target.value)} placeholder="Es. chiuso per ferie" />
          </label>
          <Button type="submit"><Plus size={14} /> Aggiungi</Button>
        </form>
        {blackoutDates === null ? null : blackoutDates.length === 0 ? (
          <p className="muted" style={{ marginTop: 10 }}>Nessuna data segnata come non disponibile.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'grid', gap: 6 }}>
            {blackoutDates.map((blackout) => (
              <li key={blackout.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span>{new Date(`${blackout.blackoutDate}T00:00:00`).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}{blackout.note ? ` — ${blackout.note}` : ''}</span>
                <Button variant="ghost" size="sm" aria-label="Rimuovi" onClick={() => void removeBlackout(blackout.id)}><Trash2 size={16} /></Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

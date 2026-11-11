import { useEffect, useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Button } from '@homisuite/ui'
import { UserRound } from 'lucide-react'
import { saveMyPreferences } from './api'
import { AGENT_LANGUAGES, TONE_LABELS } from './labels'
import type { AgentPreferences, Tone } from './types'

// Every agent's own corner of the settings: how the assistant writes the
// replies *they* send, and which languages they read (no Italian
// translation under drafts in those). Nobody else sees or changes it.
export function MyStyleCard({ client, propertyId, profileId, propertyTone, preferences, onSaved }: {
  client: SupabaseClient
  propertyId: string
  profileId: string | null
  propertyTone: Tone
  preferences: AgentPreferences
  onSaved: (next: AgentPreferences) => void
}) {
  const [draft, setDraft] = useState(preferences)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setDraft(preferences) }, [preferences])

  function toggleLanguage(code: string) {
    setSaved(false)
    setDraft((current) => ({
      ...current,
      languages: current.languages.includes(code) ? current.languages.filter((item) => item !== code) : [...current.languages, code],
    }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profileId) return
    setSaving(true)
    setError(null)
    setSaved(false)
    const next = { ...draft, instructions: draft.instructions.trim() }
    try {
      await saveMyPreferences(client, propertyId, profileId, next)
      onSaved(next)
      setSaved(true)
    } catch {
      setError('Preferenze non salvate. Riprova.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="shell-card">
      <div className="section-heading">
        <h2><UserRound size={17} aria-hidden="true" /> Il mio stile</h2>
        <p>Solo per te: l'assistente scrive così le risposte che invii tu e quelle degli ospiti che segui. Le regole della struttura restano valide.</p>
      </div>
      <form className="modal-form smart-inbox-settings-form" onSubmit={submit}>
        <label className="form-field">
          <span>Il mio tono</span>
          <select value={draft.tone ?? ''} onChange={(event) => { setSaved(false); setDraft({ ...draft, tone: (event.target.value || null) as Tone | null }) }}>
            <option value="">Come la struttura ({TONE_LABELS[propertyTone]})</option>
            {(Object.keys(TONE_LABELS) as Tone[]).map((tone) => <option key={tone} value={tone}>{TONE_LABELS[tone]}</option>)}
          </select>
        </label>
        <label className="form-field">
          <span>Indicazioni per l'assistente <em className="muted">(facoltative)</em></span>
          <textarea
            rows={3}
            maxLength={600}
            value={draft.instructions}
            onChange={(event) => { setSaved(false); setDraft({ ...draft, instructions: event.target.value }) }}
            placeholder="Es. do sempre del lei; frasi brevi; chiudo con 'A presto'."
          />
          <small>{draft.instructions.length}/600</small>
        </label>
        <fieldset className="smart-inbox-sources">
          <legend>Lingue che leggo</legend>
          {AGENT_LANGUAGES.map(({ code, label }) => (
            <label key={code} className={`smart-inbox-filter-chip${draft.languages.includes(code) ? ' active' : ''}`}>
              <input type="checkbox" className="sr-only" checked={draft.languages.includes(code)} onChange={() => toggleLanguage(code)} />
              {label}
            </label>
          ))}
        </fieldset>
        <p className="muted smart-inbox-note">Sotto le bozze in queste lingue non vedrai la traduzione italiana.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="smart-inbox-buttons">
          <Button variant="primary" type="submit" disabled={saving || !profileId}>{saving ? 'Salvataggio…' : 'Salva il mio stile'}</Button>
          {saved ? <span className="smart-inbox-notice" role="status">Salvato.</span> : null}
        </div>
      </form>
    </section>
  )
}

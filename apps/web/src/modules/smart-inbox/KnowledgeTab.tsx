import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Button, Modal } from '@homisuite/ui'
import { BookOpenText, HelpCircle, Pencil, Plus, Search } from 'lucide-react'
import { PageState } from '../../components/PageState'
import { Select } from '../../components/Select'
import { Switch } from '../../components/Switch'
import { useConfirm } from '../../components/ConfirmDialog'
import { createKnowledge, deleteKnowledge, listKnowledge, loadGaps, updateKnowledge } from './api'
import { KNOWLEDGE_CATEGORY_LABELS } from './labels'
import type { KnowledgeCategory, KnowledgeEntry } from './types'

const CATEGORIES = Object.keys(KNOWLEDGE_CATEGORY_LABELS) as KnowledgeCategory[]
type EntryValues = Pick<KnowledgeEntry, 'title' | 'content' | 'category' | 'assistant_note'>

function updatedLabel(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days < 1) return 'Aggiornata oggi'
  if (days === 1) return 'Aggiornata ieri'
  if (days < 14) return `Aggiornata ${days} giorni fa`
  if (days < 60) return `Aggiornata ${Math.floor(days / 7)} settimane fa`
  return `Aggiornata ${Math.floor(days / 30)} mesi fa`
}

const EXAMPLES = ['Check-in e check-out', 'Colazione', 'Parcheggio', 'Come arrivare', 'Animali', 'Cancellazioni', 'Spa e piscina', 'Ristoranti consigliati']

// The hotel's own facts the assistant may use. Everything not written here
// is, by design, something the assistant must not answer on its own.
export function KnowledgeTab({ client, propertyId, canManage }: { client: SupabaseClient; propertyId: string; canManage: boolean }) {
  const [entries, setEntries] = useState<KnowledgeEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<KnowledgeEntry | Partial<EntryValues> | null>(null)
  const [gaps, setGaps] = useState<Array<{ topic: string; count: number }>>([])
  const [category, setCategory] = useState<'' | KnowledgeCategory>('')
  const [query, setQuery] = useState('')
  const [confirmDialog, confirm] = useConfirm()

  const load = useCallback(async () => {
    try {
      setError(null)
      const [next, found] = await Promise.all([
        listKnowledge(client, propertyId),
        loadGaps(client, propertyId).catch(() => ({ missingInfo: [], templateGaps: [] })),
      ])
      setEntries(next)
      setGaps(found.missingInfo)
    } catch (cause) {
      console.error('Smart Inbox: knowledge not loaded', cause)
      setError('Impossibile caricare le informazioni. Riprova.')
      setEntries((current) => current ?? [])
    }
  }, [client, propertyId])

  useEffect(() => { void load() }, [load])

  async function toggle(entry: KnowledgeEntry) {
    setEntries((current) => current?.map((item) => item.id === entry.id ? { ...item, active: !item.active } : item) ?? null)
    try {
      await updateKnowledge(client, entry.id, { active: !entry.active })
    } catch {
      setError('Modifica non salvata. Riprova.')
      await load()
    }
  }

  async function remove(entry: KnowledgeEntry) {
    const confirmed = await confirm({
      title: 'Eliminare questa sezione?',
      description: `"${entry.title}" non sarà più usata per le risposte.`,
      confirmLabel: 'Elimina',
    })
    if (!confirmed) return
    try {
      await deleteKnowledge(client, entry.id)
      setEditing(null)
      await load()
    } catch {
      setError('Eliminazione non riuscita. Riprova.')
    }
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (entries ?? []).filter((entry) => (!category || entry.category === category)
      && (!needle || entry.title.toLowerCase().includes(needle) || entry.content.toLowerCase().includes(needle)))
  }, [entries, category, query])

  // A topic guests asked about counts as covered once an entry with that
  // word in its title exists.
  const openGaps = gaps.filter((gap) => {
    const word = gap.topic.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/)[0]
    return !word || !(entries ?? []).some((entry) => entry.title.toLowerCase().includes(word))
  })

  if (!entries) return <PageState kind="loading" title="Caricamento informazioni…" />

  return (
    <div className="page-stack">
    {openGaps.length > 0 ? (
      <section className="shell-card smart-inbox-gaps">
        <h2><HelpCircle size={16} aria-hidden="true" /> Gli ospiti hanno chiesto, ma qui non c'è la risposta</h2>
        <ul>
          {openGaps.map((gap) => (
            <li key={gap.topic}>
              <span><strong>{gap.topic}</strong> · chiesto {gap.count === 1 ? 'una volta' : `${gap.count} volte`}</span>
              {canManage ? <Button variant="secondary" onClick={() => setEditing({ title: gap.topic })}>Aggiungi</Button> : null}
            </li>
          ))}
        </ul>
      </section>
    ) : null}
    <section className="shell-card">
      <div className="section-heading split">
        <div>
          <h2>Informazioni hotel</h2>
          <p>L'assistente risponde solo con quello che trova scritto qui. Si scrive una volta sola: se cambi un prezzo, modelli e risposte usano subito quello nuovo.</p>
        </div>
        {canManage ? <button className="secondary-action" type="button" onClick={() => setEditing({})}><Plus size={16} /> Nuova informazione</button> : null}
      </div>
      <div className="smart-inbox-filters smart-inbox-pad">
        <label className="smart-inbox-search">
          <Search size={14} aria-hidden="true" />
          <span className="sr-only">Cerca un'informazione</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca un'informazione" />
        </label>
        <button type="button" className={`smart-inbox-filter-chip${category === '' ? ' active' : ''}`} aria-pressed={category === ''} onClick={() => setCategory('')}>Tutte ({entries.length})</button>
        {CATEGORIES.map((value) => (
          <button key={value} type="button" className={`smart-inbox-filter-chip${category === value ? ' active' : ''}`} aria-pressed={category === value} onClick={() => setCategory(value)}>
            {KNOWLEDGE_CATEGORY_LABELS[value]}
          </button>
        ))}
      </div>
      {error ? <div className="shell-alert error" role="alert" style={{ margin: '0 20px 14px' }}>{error}</div> : null}

      {entries.length === 0 ? (
        <PageState
          kind="empty"
          icon={BookOpenText}
          title="Nessuna informazione ancora."
          description={`Aggiungi una sezione per ogni argomento, per esempio: ${EXAMPLES.slice(0, 5).join(', ')}.`}
        />
      ) : visible.length === 0 ? (
        <p className="muted smart-inbox-note smart-inbox-pad">Nessuna informazione trovata.</p>
      ) : (
        <ul className="smart-inbox-knowledge">
          {visible.map((entry) => (
            <li key={entry.id} className={entry.active ? '' : 'inactive'}>
              <div className="smart-inbox-knowledge-text">
                <strong>{entry.title} <span className="smart-inbox-chip info">{KNOWLEDGE_CATEGORY_LABELS[entry.category]}</span></strong>
                <p>{entry.content}</p>
                {entry.assistant_note ? <p className="smart-inbox-assistant-note">Nota per l'assistente: {entry.assistant_note}</p> : null}
                <small className="muted">{updatedLabel(entry.updated_at)}</small>
              </div>
              <div className="smart-inbox-knowledge-actions">
                <Switch checked={entry.active} onChange={() => void toggle(entry)} aria-label={`Usa "${entry.title}" nelle risposte`} disabled={!canManage} />
                {canManage ? <button className="icon-button" type="button" aria-label={`Modifica ${entry.title}`} onClick={() => setEditing(entry)}><Pencil size={15} /></button> : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <KnowledgeModal
        entry={editing}
        onClose={() => setEditing(null)}
        onSave={async (values) => {
          if (editing && 'id' in editing && editing.id) await updateKnowledge(client, editing.id, values)
          else await createKnowledge(client, propertyId, { ...values, sort_order: entries.length })
          setEditing(null)
          await load()
        }}
        onDelete={remove}
      />
      {confirmDialog}
    </section>
    </div>
  )
}

function KnowledgeModal({ entry, onClose, onSave, onDelete }: {
  entry: KnowledgeEntry | Partial<EntryValues> | null
  onClose: () => void
  onSave: (values: EntryValues) => Promise<void>
  onDelete: (entry: KnowledgeEntry) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const existing = entry && 'id' in entry && entry.id ? entry as KnowledgeEntry : null
  const initial = entry ?? {}
  const [category, setCategory] = useState<KnowledgeCategory>(initial.category ?? 'servizi')

  // initial is derived from entry every render, so entry alone is the right
  // dependency -- initial.category only ever changes when entry does.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (entry) { setSaving(false); setError(null); setCategory(initial.category ?? 'servizi') } }, [entry])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const title = String(data.get('title') ?? '').trim()
    const content = String(data.get('content') ?? '').trim()
    const assistantNote = String(data.get('assistant_note') ?? '').trim()
    if (!title || !content) {
      setError('Titolo e testo sono obbligatori.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave({ title, content, category, assistant_note: assistantNote })
    } catch {
      setError('Salvataggio non riuscito. Riprova.')
      setSaving(false)
    }
  }

  return (
    <Modal
      open={Boolean(entry)}
      title={existing ? 'Modifica informazione' : 'Nuova informazione'}
      description="Scrivi le informazioni come le daresti a un collega appena arrivato in reception."
      onClose={onClose}
      dismissible={false}
      footer={(
        <>
          {existing ? <Button variant="danger" className="push-left" onClick={() => void onDelete(existing)} disabled={saving}>Elimina</Button> : null}
          <Button variant="secondary" onClick={onClose}>Annulla</Button>
          <Button variant="primary" type="submit" form="smart-inbox-knowledge-form" disabled={saving}>{saving ? 'Salvataggio…' : 'Salva'}</Button>
        </>
      )}
    >
      <form className="modal-form" id="smart-inbox-knowledge-form" onSubmit={submit} key={existing?.id ?? `new-${initial.title ?? ''}`}>
        <label className="form-field">
          <span>Titolo</span>
          <input name="title" required maxLength={200} defaultValue={initial.title ?? ''} placeholder="Es. Colazione" />
        </label>
        <label className="form-field">
          <span>Categoria</span>
          <Select name="category" value={category} onChange={(value) => setCategory(value as KnowledgeCategory)}>
            {CATEGORIES.map((value) => <option key={value} value={value}>{KNOWLEDGE_CATEGORY_LABELS[value]}</option>)}
          </Select>
        </label>
        <label className="form-field">
          <span>Informazioni</span>
          <textarea name="content" required rows={8} maxLength={20000} defaultValue={initial.content ?? ''} placeholder="Es. Servita dalle 7:00 alle 10:30 nella sala al piano terra. Inclusa in tutte le tariffe. Opzioni senza glutine su richiesta." />
        </label>
        <label className="form-field">
          <span>Nota per l'assistente <em className="muted">(facoltativa)</em></span>
          <textarea name="assistant_note" rows={2} maxLength={2000} defaultValue={initial.assistant_note ?? ''} placeholder="Es. altezza massima 2,10 m: i furgoni non entrano. Non viene scritta all'ospite così com'è." />
          <small>Dettagli che l'assistente deve sapere per rispondere bene.</small>
        </label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </form>
    </Modal>
  )
}

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Button, Modal } from '@homisuite/ui'
import { BookOpenText, Pencil, Plus } from 'lucide-react'
import { PageState } from '../../components/PageState'
import { Switch } from '../../components/Switch'
import { useConfirm } from '../../components/ConfirmDialog'
import { createKnowledge, deleteKnowledge, listKnowledge, updateKnowledge } from './api'
import type { KnowledgeEntry } from './types'

const EXAMPLES = ['Check-in e check-out', 'Colazione', 'Parcheggio', 'Come arrivare', 'Animali', 'Cancellazioni', 'Spa e piscina', 'Ristoranti consigliati']

// The hotel's own facts the assistant may use. Everything not written here
// is, by design, something the assistant must not answer on its own.
export function KnowledgeTab({ client, propertyId, canManage }: { client: SupabaseClient; propertyId: string; canManage: boolean }) {
  const [entries, setEntries] = useState<KnowledgeEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<KnowledgeEntry | 'new' | null>(null)
  const [confirmDialog, confirm] = useConfirm()

  const load = useCallback(async () => {
    try {
      setError(null)
      setEntries(await listKnowledge(client, propertyId))
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

  if (!entries) return <PageState kind="loading" title="Caricamento informazioni…" />

  return (
    <section className="shell-card">
      <div className="section-heading split">
        <div>
          <h2>Informazioni per le risposte</h2>
          <p>L'assistente risponde solo con quello che trova scritto qui. Più è completo, meno email restano da gestire a mano.</p>
        </div>
        {canManage ? <button className="secondary-action" type="button" onClick={() => setEditing('new')}><Plus size={16} /> Nuova sezione</button> : null}
      </div>
      {error ? <div className="shell-alert error" role="alert" style={{ margin: '0 20px 14px' }}>{error}</div> : null}

      {entries.length === 0 ? (
        <PageState
          kind="empty"
          icon={BookOpenText}
          title="Nessuna informazione ancora."
          description={`Aggiungi una sezione per ogni argomento, per esempio: ${EXAMPLES.slice(0, 5).join(', ')}.`}
        />
      ) : (
        <ul className="smart-inbox-knowledge">
          {entries.map((entry) => (
            <li key={entry.id} className={entry.active ? '' : 'inactive'}>
              <div className="smart-inbox-knowledge-text">
                <strong>{entry.title}</strong>
                <p>{entry.content}</p>
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
          if (editing && editing !== 'new') await updateKnowledge(client, editing.id, values)
          else await createKnowledge(client, propertyId, { ...values, sort_order: entries.length })
          setEditing(null)
          await load()
        }}
        onDelete={remove}
      />
      {confirmDialog}
    </section>
  )
}

function KnowledgeModal({ entry, onClose, onSave, onDelete }: {
  entry: KnowledgeEntry | 'new' | null
  onClose: () => void
  onSave: (values: { title: string; content: string }) => Promise<void>
  onDelete: (entry: KnowledgeEntry) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const existing = entry && entry !== 'new' ? entry : null

  useEffect(() => { if (entry) { setSaving(false); setError(null) } }, [entry])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const title = String(data.get('title') ?? '').trim()
    const content = String(data.get('content') ?? '').trim()
    if (!title || !content) {
      setError('Titolo e testo sono obbligatori.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave({ title, content })
    } catch {
      setError('Salvataggio non riuscito. Riprova.')
      setSaving(false)
    }
  }

  return (
    <Modal
      open={Boolean(entry)}
      title={existing ? 'Modifica sezione' : 'Nuova sezione'}
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
      <form className="modal-form" id="smart-inbox-knowledge-form" onSubmit={submit} key={existing?.id ?? 'new'}>
        <label className="form-field">
          <span>Titolo</span>
          <input name="title" required maxLength={200} defaultValue={existing?.title ?? ''} placeholder="Es. Colazione" />
        </label>
        <label className="form-field">
          <span>Informazioni</span>
          <textarea name="content" required rows={8} maxLength={20000} defaultValue={existing?.content ?? ''} placeholder="Es. Servita dalle 7:00 alle 10:30 nella sala al piano terra. Inclusa in tutte le tariffe. Opzioni senza glutine su richiesta." />
        </label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </form>
    </Modal>
  )
}

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Button, Modal } from '@homisuite/ui'
import { FileText, Pencil, Plus } from 'lucide-react'
import { PageState } from '../../components/PageState'
import { useConfirm } from '../../components/ConfirmDialog'
import { createTemplate, deleteTemplate, listTemplates, updateTemplate } from './api'
import type { ReplyTemplate } from './types'

// Ready-made answers staff insert into a reply with one click. The
// assistant sees them too and follows their wording when one fits.
export function TemplatesTab({ client, propertyId, canManage }: { client: SupabaseClient; propertyId: string; canManage: boolean }) {
  const [templates, setTemplates] = useState<ReplyTemplate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ReplyTemplate | 'new' | null>(null)
  const [confirmDialog, confirm] = useConfirm()

  const load = useCallback(async () => {
    try {
      setError(null)
      setTemplates(await listTemplates(client, propertyId))
    } catch (cause) {
      console.error('Smart Inbox: templates not loaded', cause)
      setError('Impossibile caricare i modelli. Riprova.')
      setTemplates((current) => current ?? [])
    }
  }, [client, propertyId])

  useEffect(() => { void load() }, [load])

  async function remove(template: ReplyTemplate) {
    const confirmed = await confirm({
      title: 'Eliminare questo modello?',
      description: `"${template.title}" non sarà più disponibile nelle risposte.`,
      confirmLabel: 'Elimina',
    })
    if (!confirmed) return
    try {
      await deleteTemplate(client, template.id)
      setEditing(null)
      await load()
    } catch {
      setError('Eliminazione non riuscita. Riprova.')
    }
  }

  if (!templates) return <PageState kind="loading" title="Caricamento modelli…" />

  return (
    <section className="shell-card">
      <div className="section-heading split">
        <div>
          <h2>Modelli di risposta</h2>
          <p>Risposte pronte da inserire con un clic. Scrivi <strong>{'{nome}'}</strong> dove va il nome dell'ospite.</p>
        </div>
        {canManage ? <button className="secondary-action" type="button" onClick={() => setEditing('new')}><Plus size={16} /> Nuovo modello</button> : null}
      </div>
      {error ? <div className="shell-alert error" role="alert" style={{ margin: '0 20px 14px' }}>{error}</div> : null}

      {templates.length === 0 ? (
        <PageState
          kind="empty"
          icon={FileText}
          title="Nessun modello ancora."
          description="Ad esempio: conferma prenotazione, istruzioni per il check-in, come arrivare, politica di cancellazione."
        />
      ) : (
        <ul className="smart-inbox-knowledge">
          {templates.map((template) => (
            <li key={template.id}>
              <div className="smart-inbox-knowledge-text">
                <strong>{template.title}</strong>
                <p>{template.body}</p>
              </div>
              {canManage ? (
                <div className="smart-inbox-knowledge-actions">
                  <button className="icon-button" type="button" aria-label={`Modifica ${template.title}`} onClick={() => setEditing(template)}><Pencil size={15} /></button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <TemplateModal
        template={editing}
        onClose={() => setEditing(null)}
        onSave={async (values) => {
          if (editing && editing !== 'new') await updateTemplate(client, editing.id, values)
          else await createTemplate(client, propertyId, { ...values, sort_order: templates.length })
          setEditing(null)
          await load()
        }}
        onDelete={remove}
      />
      {confirmDialog}
    </section>
  )
}

function TemplateModal({ template, onClose, onSave, onDelete }: {
  template: ReplyTemplate | 'new' | null
  onClose: () => void
  onSave: (values: { title: string; body: string }) => Promise<void>
  onDelete: (template: ReplyTemplate) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const existing = template && template !== 'new' ? template : null

  useEffect(() => { if (template) { setSaving(false); setError(null) } }, [template])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const title = String(data.get('title') ?? '').trim()
    const body = String(data.get('body') ?? '').trim()
    if (!title || !body) {
      setError('Nome e testo sono obbligatori.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave({ title, body })
    } catch {
      setError('Salvataggio non riuscito. Riprova.')
      setSaving(false)
    }
  }

  return (
    <Modal
      open={Boolean(template)}
      title={existing ? 'Modifica modello' : 'Nuovo modello'}
      onClose={onClose}
      dismissible={false}
      footer={(
        <>
          {existing ? <Button variant="danger" className="push-left" onClick={() => void onDelete(existing)} disabled={saving}>Elimina</Button> : null}
          <Button variant="secondary" onClick={onClose}>Annulla</Button>
          <Button variant="primary" type="submit" form="smart-inbox-template-form" disabled={saving}>{saving ? 'Salvataggio…' : 'Salva'}</Button>
        </>
      )}
    >
      <form className="modal-form" id="smart-inbox-template-form" onSubmit={submit} key={existing?.id ?? 'new'}>
        <label className="form-field">
          <span>Nome del modello</span>
          <input name="title" required maxLength={120} defaultValue={existing?.title ?? ''} placeholder="Es. Istruzioni check-in" />
        </label>
        <label className="form-field">
          <span>Testo</span>
          <textarea name="body" required rows={9} maxLength={8000} defaultValue={existing?.body ?? ''} placeholder={'Gentile {nome},\n\nil check-in è dalle 14:00. Alla reception troverà…'} />
          <small>{'{nome}'} viene sostituito dal nome dell'ospite quando inserisci il modello.</small>
        </label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </form>
    </Modal>
  )
}

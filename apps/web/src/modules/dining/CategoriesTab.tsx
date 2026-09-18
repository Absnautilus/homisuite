import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Pencil, Plus, UtensilsCrossed } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { useConfirm } from '../../components/ConfirmDialog'
import { supabase } from '../../core/client'
import { createCategory, deleteCategory, listCategories, updateCategory } from './api'
import type { DiningCategory } from './types'
import { readableDiningError } from './readableDiningError'

interface CategoriesTabProps {
  hotelId: string
  canManage: boolean
}

export function CategoriesTab({ hotelId, canManage }: CategoriesTabProps) {
  const [categories, setCategories] = useState<DiningCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<DiningCategory | 'new' | null>(null)
  const [confirmDialog, confirm] = useConfirm()

  const load = useCallback(async () => {
    try {
      setError(null)
      setCategories(await listCategories(supabase, hotelId))
    } catch (cause) {
      setError(readableDiningError(cause))
    } finally {
      setLoading(false)
    }
  }, [hotelId])

  useEffect(() => { void load() }, [load])

  async function onDelete(category: DiningCategory) {
    const confirmed = await confirm({
      title: 'Eliminare la categoria?',
      description: `"${category.name}" verrà rimossa. I ristoranti collegati non saranno eliminati.`,
      confirmLabel: 'Elimina',
    })
    if (!confirmed) return
    try {
      await deleteCategory(supabase, category.id)
      await load()
    } catch (cause) {
      setError(readableDiningError(cause))
    }
  }

  return (
    <section className="shell-card">
      <div className="section-heading split">
        <div><h2>Categorie ristoranti</h2><p>Personalizza le categorie con cui organizzare il ristorante.</p></div>
        {canManage ? <button className="secondary-action" type="button" onClick={() => setEditing('new')}><Plus size={16} /> Nuova categoria</button> : null}
      </div>
      {error ? <div className="shell-alert error" role="alert">{error}</div> : null}
      <div className="job-role-grid">
        {categories.map((category) => canManage
          ? <button className="job-role-chip active" type="button" key={category.id} onClick={() => setEditing(category)}><UtensilsCrossed size={15} /><span>{category.name}</span><Pencil size={12} /></button>
          : <div className="job-role-chip active" key={category.id}><UtensilsCrossed size={15} /><span>{category.name}</span></div>)}
        {!loading && categories.length === 0 ? <span className="muted">Nessuna categoria creata.</span> : null}
      </div>
      <CategoryModal
        category={editing}
        onClose={() => setEditing(null)}
        onSaved={async () => { setEditing(null); await load() }}
        onDelete={onDelete}
        hotelId={hotelId}
      />
      {confirmDialog}
    </section>
  )
}

function CategoryModal({ category, hotelId, onClose, onSaved, onDelete }: {
  category: DiningCategory | 'new' | null
  hotelId: string
  onClose: () => void
  onSaved: () => Promise<void>
  onDelete: (category: DiningCategory) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const existing = category && category !== 'new' ? category : null

  useEffect(() => { if (category) { setSaving(false); setError(null) } }, [category])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const name = String(new FormData(event.currentTarget).get('name'))
      if (existing) await updateCategory(supabase, existing.id, { name })
      else await createCategory(supabase, hotelId, name)
      await onSaved()
    } catch (cause) {
      setError(readableDiningError(cause))
      setSaving(false)
    }
  }

  return (
    <Modal
      open={Boolean(category)}
      title={existing ? 'Modifica categoria' : 'Nuova categoria'}
      onClose={onClose}
      dismissible={false}
      footer={(
        <>
          {existing ? <button className="btn btn-danger push-left" type="button" onClick={() => void onDelete(existing)} disabled={saving}>Elimina</button> : null}
          <button className="btn btn-secondary" type="button" onClick={onClose}>Annulla</button>
          <button className="btn btn-primary" type="submit" form="category-form" disabled={saving}>{saving ? 'Salvataggio…' : 'Salva'}</button>
        </>
      )}
    >
      <form className="modal-form" id="category-form" onSubmit={submit}>
        <label className="form-field"><span>Nome categoria</span><input name="name" required minLength={1} maxLength={80} defaultValue={existing?.name ?? ''} /></label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </form>
    </Modal>
  )
}

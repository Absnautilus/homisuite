import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Button, Modal, useUndo } from '@homisuite/ui'
import { Pencil, Plus, UtensilsCrossed } from 'lucide-react'
import { useConfirm } from '../../components/ConfirmDialog'
import { Switch } from '../../components/Switch'
import { supabase } from '../../core/client'
import { createCategory, deleteCategory, listCategories, restoreCategory, subscribeToCategories, updateCategory } from './api'
import type { DiningCategory } from './types'
import { readableDiningError } from './readableDiningError'

const CATEGORY_PHOTO_BUCKET = 'dining-category-photos'
const CATEGORY_PHOTO_MAX_BYTES = 3 * 1024 * 1024
const CATEGORY_PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp'

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
  const pushUndo = useUndo()

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

  // Same reasoning as RestaurantsTab's own subscription -- another staff
  // member's edit here would otherwise only show up on this session's next
  // manual page reload.
  useEffect(() => {
    return subscribeToCategories(supabase, hotelId, () => void load())
  }, [hotelId, load])

  async function toggleActive(category: DiningCategory) {
    setCategories((current) => current.map((c) => c.id === category.id ? { ...c, active: !c.active } : c))
    try {
      await updateCategory(supabase, category.id, { active: !category.active })
    } catch (cause) {
      setError(readableDiningError(cause))
      await load()
    }
  }

  async function setPriority(category: DiningCategory, value: number) {
    setCategories((current) => current.map((c) => c.id === category.id ? { ...c, sort_order: value } : c))
    try {
      await updateCategory(supabase, category.id, { sort_order: value })
    } catch (cause) {
      setError(readableDiningError(cause))
      await load()
    }
  }

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
      pushUndo({
        message: `Categoria "${category.name}" eliminata.`,
        undo: async () => {
          await restoreCategory(supabase, category)
          await load()
        },
      })
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
      <div>
        {categories.length > 0 ? (
          <div className="dining-cat-row dining-cat-head">
            <span /><span /><span>Visibile</span><span>Priorità</span>
          </div>
        ) : null}
        {categories.map((category) => (
          <div className="dining-cat-row" key={category.id} onClick={() => canManage && setEditing(category)}>
            {category.image_url
              ? <img className="dining-rest-thumb" src={category.image_url} alt="" />
              : <div className="dining-rest-thumb"><UtensilsCrossed size={16} /></div>}
            <div className="dining-rest-main">
              <strong>{category.name}{canManage ? <Pencil size={12} aria-hidden="true" /> : null}</strong>
            </div>
            <div className="dining-switch-cell" onClick={canManage ? (event) => event.stopPropagation() : undefined}>
              <Switch checked={category.active} onChange={() => void toggleActive(category)} aria-label={`Visibile — ${category.name}`} disabled={!canManage} />
            </div>
            {canManage ? (
              <input
                type="number"
                className="dining-priority-input"
                value={category.sort_order}
                onClick={(event) => event.stopPropagation()}
                onChange={(e) => void setPriority(category, Number(e.target.value))}
                aria-label={`Priorità — ${category.name}`}
              />
            ) : <span />}
          </div>
        ))}
        {!loading && categories.length === 0 ? <p className="muted dining-empty-hint">Nessuna categoria creata.</p> : null}
      </div>
      <CategoryModal
        category={editing}
        onClose={() => setEditing(null)}
        onSaved={async () => { setEditing(null); await load() }}
        onRefresh={load}
        onDelete={onDelete}
        hotelId={hotelId}
      />
      {confirmDialog}
    </section>
  )
}

function CategoryModal({ category, hotelId, onClose, onSaved, onRefresh, onDelete }: {
  category: DiningCategory | 'new' | null
  hotelId: string
  onClose: () => void
  onSaved: () => Promise<void>
  // Refreshes the chip list in the background without closing the modal --
  // distinct from onSaved, which always closes it. A photo upload/removal
  // needs the former: the person stays on this same modal to see the new
  // preview (or go on to edit the name), instead of getting bounced out
  // the moment the upload finishes.
  onRefresh: () => Promise<void>
  onDelete: (category: DiningCategory) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const existing = category && category !== 'new' ? category : null

  useEffect(() => {
    if (!category) return
    setSaving(false)
    setError(null)
    setPhotoBusy(false)
    setPhotoError(null)
    // Local state, not read from `existing` on every render: a background
    // onRefresh() updates the parent's category list, but `category` here
    // is still the exact object reference captured when this modal opened,
    // so it would otherwise keep showing the pre-upload photo (or lack of
    // one) for as long as the modal stays open.
    setPhotoUrl(existing?.image_url ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category])

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

  async function onPhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (photoInputRef.current) photoInputRef.current.value = ''
    if (!file || !existing) return
    if (!CATEGORY_PHOTO_ACCEPT.split(',').includes(file.type)) { setPhotoError('Usa un file JPG, PNG o WEBP.'); return }
    if (file.size > CATEGORY_PHOTO_MAX_BYTES) { setPhotoError('Il file supera i 3 MB consentiti.'); return }
    setPhotoBusy(true)
    setPhotoError(null)
    try {
      const path = `${hotelId}/${existing.id}`
      const { error: uploadError } = await supabase.storage.from(CATEGORY_PHOTO_BUCKET).upload(path, file, { upsert: true, contentType: file.type })
      if (uploadError) throw uploadError
      const publicUrl = supabase.storage.from(CATEGORY_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl
      const versionedUrl = `${publicUrl}?v=${Date.now()}`
      await updateCategory(supabase, existing.id, { image_url: versionedUrl })
      setPhotoUrl(versionedUrl)
      await onRefresh()
    } catch {
      setPhotoError('Non è stato possibile caricare la foto.')
    } finally {
      setPhotoBusy(false)
    }
  }

  async function onPhotoRemove() {
    if (!existing) return
    setPhotoBusy(true)
    setPhotoError(null)
    try {
      const { error: removeError } = await supabase.storage.from(CATEGORY_PHOTO_BUCKET).remove([`${hotelId}/${existing.id}`])
      if (removeError) throw removeError
      await updateCategory(supabase, existing.id, { image_url: null })
      setPhotoUrl(null)
      await onRefresh()
    } catch {
      setPhotoError('Non è stato possibile rimuovere la foto.')
    } finally {
      setPhotoBusy(false)
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
          {existing ? <Button variant="danger" className="push-left" onClick={() => void onDelete(existing)} disabled={saving}>Elimina</Button> : null}
          <Button variant="secondary" onClick={onClose}>Annulla</Button>
          <Button variant="primary" type="submit" form="category-form" disabled={saving}>{saving ? 'Salvataggio…' : 'Salva'}</Button>
        </>
      )}
    >
      <form className="modal-form" id="category-form" onSubmit={submit}>
        {existing ? (
          <div className="form-field">
            <span>Foto categoria</span>
            <div className="logo-picker">
              {photoUrl ? <img src={photoUrl} alt="" className="logo-picker-preview" /> : <div className="logo-picker-placeholder" aria-hidden="true" />}
              <div className="logo-picker-actions">
                <Button type="button" variant="secondary" onClick={() => photoInputRef.current?.click()} disabled={photoBusy}>
                  {photoBusy ? 'Attendere…' : photoUrl ? 'Cambia foto' : 'Carica foto'}
                </Button>
                {photoUrl ? <button className="link-button" type="button" onClick={() => void onPhotoRemove()} disabled={photoBusy}>Rimuovi</button> : null}
                <input ref={photoInputRef} type="file" accept={CATEGORY_PHOTO_ACCEPT} hidden onChange={onPhotoChange} />
              </div>
            </div>
            <small>JPG, PNG o WEBP · max 3 MB</small>
            {photoError ? <p className="form-error" role="alert">{photoError}</p> : null}
          </div>
        ) : (
          <p className="muted">Potrai caricare una foto dopo aver salvato la categoria.</p>
        )}
        <label className="form-field"><span>Nome categoria</span><input name="name" required minLength={1} maxLength={80} defaultValue={existing?.name ?? ''} /></label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </form>
    </Modal>
  )
}

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Plus, X } from 'lucide-react'
import { useConfirm } from '../../components/ConfirmDialog'
import { supabase } from '../../core/client'
import { useUndo } from '@homisuite/ui'
import { createGuestTag, deleteGuestTag, listGuestTags, restoreGuestTag } from './api'
import type { GuestTag } from './types'
import { readableDiningError } from './readableDiningError'
import { PartnerAccountsSection } from './PartnerAccountsSection'

interface SettingsTabProps {
  hotelId: string
  canManage: boolean
}

export function SettingsTab({ hotelId, canManage }: SettingsTabProps) {
  const [guestTags, setGuestTags] = useState<GuestTag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newTag, setNewTag] = useState('')
  const [confirmDialog, confirm] = useConfirm()
  const pushUndo = useUndo()

  const load = useCallback(async () => {
    try {
      setError(null)
      setGuestTags(await listGuestTags(supabase, hotelId))
    } catch (cause) {
      setError(readableDiningError(cause))
    } finally {
      setLoading(false)
    }
  }, [hotelId])

  useEffect(() => { void load() }, [load])

  async function addTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!newTag.trim()) return
    try {
      await createGuestTag(supabase, hotelId, newTag.trim())
      setNewTag('')
      await load()
    } catch (cause) {
      setError(readableDiningError(cause))
    }
  }

  async function removeTag(tag: GuestTag) {
    const confirmed = await confirm({
      title: 'Rimuovere il tag?',
      description: `"${tag.label}" non sarà più selezionabile per nuove prenotazioni.`,
      confirmLabel: 'Rimuovi',
    })
    if (!confirmed) return
    try {
      await deleteGuestTag(supabase, tag.id)
      await load()
      pushUndo({
        message: `Tag "${tag.label}" rimosso.`,
        undo: async () => {
          await restoreGuestTag(supabase, tag)
          await load()
        },
      })
    } catch (cause) {
      setError(readableDiningError(cause))
    }
  }

  return (
    <div className="page-stack">
      {error ? <div className="shell-alert error" role="alert">{error}</div> : null}

      <section className="shell-card">
        <div className="section-heading" style={{ padding: '16px 20px 0' }}>
          <h2>Tag per le preferenze ospite</h2>
          <p>Il vocabolario che l'ospite userà per segnalare preferenze (es. "Tavolo tranquillo", "Compleanno").</p>
        </div>
        <div className="dining-tag-chip-list">
          {guestTags.map((tag) => (
            <span className="dining-tag-chip" key={tag.id}>
              {tag.label}
              {canManage ? <button type="button" aria-label={`Rimuovi ${tag.label}`} onClick={() => void removeTag(tag)}><X size={12} /></button> : null}
            </span>
          ))}
          {!loading && guestTags.length === 0 ? <span className="muted">Nessun tag configurato.</span> : null}
        </div>
        {canManage ? (
          <form className="dining-tag-add-form" onSubmit={addTag}>
            <input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Nuovo tag…" maxLength={60} />
            <button className="secondary-action" type="submit"><Plus size={14} /> Aggiungi</button>
          </form>
        ) : null}
      </section>

      <PartnerAccountsSection hotelId={hotelId} canManage={canManage} />

      {confirmDialog}
    </div>
  )
}

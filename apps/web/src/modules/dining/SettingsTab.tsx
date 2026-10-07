import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Plus, X } from 'lucide-react'
import { Switch } from '../../components/Switch'
import { useConfirm } from '../../components/ConfirmDialog'
import { supabase } from '../../core/client'
import { createGuestTag, deleteGuestTag, listGuestTags, listRestaurants, updateRestaurant } from './api'
import type { GuestTag, Restaurant } from './types'
import { readableDiningError } from './readableDiningError'

interface SettingsTabProps {
  hotelId: string
  canManage: boolean
}

export function SettingsTab({ hotelId, canManage }: SettingsTabProps) {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [guestTags, setGuestTags] = useState<GuestTag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newTag, setNewTag] = useState('')
  const [confirmDialog, confirm] = useConfirm()

  const load = useCallback(async () => {
    try {
      setError(null)
      const [nextRestaurants, nextTags] = await Promise.all([
        listRestaurants(supabase, hotelId),
        listGuestTags(supabase, hotelId),
      ])
      setRestaurants(nextRestaurants)
      setGuestTags(nextTags)
    } catch (cause) {
      setError(readableDiningError(cause))
    } finally {
      setLoading(false)
    }
  }, [hotelId])

  useEffect(() => { void load() }, [load])

  async function toggleField(restaurant: Restaurant, field: 'is_recommended' | 'active') {
    setRestaurants((current) => current.map((r) => r.id === restaurant.id ? { ...r, [field]: !r[field] } : r))
    try {
      await updateRestaurant(supabase, restaurant.id, { [field]: !restaurant[field] })
    } catch (cause) {
      setError(readableDiningError(cause))
      await load()
    }
  }

  async function setPriority(restaurant: Restaurant, value: number) {
    setRestaurants((current) => current.map((r) => r.id === restaurant.id ? { ...r, sort_order: value } : r))
    try {
      await updateRestaurant(supabase, restaurant.id, { sort_order: value })
    } catch (cause) {
      setError(readableDiningError(cause))
      await load()
    }
  }

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
    } catch (cause) {
      setError(readableDiningError(cause))
    }
  }

  const sortedRestaurants = restaurants.slice().sort((a, b) => a.sort_order - b.sort_order)

  return (
    <div className="page-stack">
      {error ? <div className="shell-alert error" role="alert">{error}</div> : null}

      <section className="shell-card">
        <div className="section-heading" style={{ padding: '16px 20px 0' }}>
          <h2>Classificazione ristoranti</h2>
          <p>Consigliato, visibilità e ordine di priorità nella vetrina ospite.</p>
        </div>
        <div className="dining-class-table">
          <div className="dining-class-row dining-class-head">
            <span>Ristorante</span><span>Consigliato</span><span>Visibile</span><span>Priorità</span>
          </div>
          {sortedRestaurants.map((restaurant) => (
            <div className="dining-class-row" key={restaurant.id}>
              <span>{restaurant.name}</span>
              <span><Switch checked={restaurant.is_recommended} onChange={() => void toggleField(restaurant, 'is_recommended')} aria-label={`Consigliato — ${restaurant.name}`} disabled={!canManage} /></span>
              <span><Switch checked={restaurant.active} onChange={() => void toggleField(restaurant, 'active')} aria-label={`Visibile — ${restaurant.name}`} disabled={!canManage} /></span>
              <span><input type="number" value={restaurant.sort_order} disabled={!canManage} style={{ width: 60, height: 32, padding: '0 8px' }} onChange={(e) => void setPriority(restaurant, Number(e.target.value))} /></span>
            </div>
          ))}
          {!loading && sortedRestaurants.length === 0 ? <p className="muted dining-empty-hint">Nessun ristorante creato.</p> : null}
        </div>
        <p style={{ padding: '0 20px 14px', fontSize: 11.5, color: 'var(--muted)', fontWeight: 600 }}>
          Accordi commerciali e provvigioni si gestiscono per singolo ristorante, nella sua scheda → Operativo (non sono un'etichetta pubblica).
        </p>
      </section>

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
      {confirmDialog}
    </div>
  )
}

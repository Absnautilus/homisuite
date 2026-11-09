import type { SupabaseClient } from '@supabase/supabase-js'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { PageHeader } from '@homisuite/ui'
import { supabase } from '../core/client'
import { useModuleRuntime } from '../core/ModuleRuntimeContext'

// The Core SDK schema currently models only Core tables; the existing
// legacy rooms/stays tables and new bridge RPC are not yet in its type map.
// Keep this compatibility client local until schema types are regenerated.
const hotelDb = supabase as unknown as SupabaseClient

type Room = { id: string; room_number: string; active: boolean }
type Stay = {
  id: string
  room_id: string
  guest_last_name: string
  guest_pin: string
  check_in_at: string
  check_out_at: string
  status: 'active' | 'closed' | 'cancelled'
  rooms: { room_number: string } | null
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String(error.code)
    if (code === '23P01') return 'La camera ha già un soggiorno attivo sovrapposto.'
    if (code === '42501') return 'Non hai i permessi per questa operazione.'
  }
  return error instanceof Error ? error.message : 'Operazione non riuscita.'
}

function toLocalDatetime(iso: string): string {
  const date = new Date(iso)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

function useCoreHotel() {
  const runtime = useModuleRuntime()
  const [hotelId, setHotelId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    setHotelId(null)
    setError(null)
    if (!runtime.property) return
    // This Core RPC checks property permissions without guest_requests.
    void hotelDb.rpc('core_hotel_id_for_property', { p_property_id: runtime.property.id })
      .then(({ data, error: rpcError }) => {
        if (!active) return
        if (rpcError) setError(rpcError.message)
        else if (typeof data === 'string') setHotelId(data)
        else setError('La struttura non è collegata a un hotel Core o non hai i permessi necessari.')
      })
    return () => { active = false }
  }, [runtime.property?.id])
  return { hotelId, error }
}

function CoreNavigation() {
  const location = useLocation()
  return (
    <nav aria-label="Gestione hotel" className="flex flex-wrap gap-3">
      <Link to="/settings/rooms" aria-current={location.pathname.endsWith('/rooms') ? 'page' : undefined}>Camere</Link>
      <Link to="/settings/stays" aria-current={location.pathname.endsWith('/stays') ? 'page' : undefined}>Soggiorni</Link>
      <Link to="/settings">Impostazioni</Link>
    </nav>
  )
}

export function CoreRoomsPage() {
  const { hotelId, error: accessError } = useCoreHotel()
  const [rooms, setRooms] = useState<Room[]>([])
  const [number, setNumber] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    if (!hotelId) return
    const result = await hotelDb.from('rooms').select('id,room_number,active')
      .eq('hotel_id', hotelId).order('room_number')
    if (result.error) throw result.error
    setRooms(result.data ?? [])
  }, [hotelId])
  useEffect(() => {
    setRooms([])
    void reload().catch((cause) => setError(errorText(cause)))
  }, [reload])

  async function addRoom(event: FormEvent) {
    event.preventDefault()
    if (!hotelId || !number.trim()) return
    setBusy(true); setError(null)
    try {
      const result = await hotelDb.from('rooms').insert({ hotel_id: hotelId, room_number: number.trim() })
      if (result.error) throw result.error
      setNumber('')
      await reload()
    } catch (cause) { setError(errorText(cause)) }
    finally { setBusy(false) }
  }

  async function toggleRoom(room: Room) {
    setError(null)
    if (room.active && !window.confirm(`Disattivare la camera ${room.room_number}?`)) return
    try {
      const result = await hotelDb.from('rooms').update({ active: !room.active })
        .eq('hotel_id', hotelId!).eq('id', room.id).select('id').maybeSingle()
      if (result.error) throw result.error
      if (!result.data) throw new Error('Aggiornamento non applicato.')
      await reload()
    } catch (cause) { setError(errorText(cause)) }
  }

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Hotel Core" title="Camere" description="Inventario condiviso, indipendente dai moduli attivi." />
      <CoreNavigation />
      {accessError && <p role="alert">{accessError}</p>}
      {error && <p role="alert">{error}</p>}
      {hotelId && (
        <>
          <form onSubmit={(e) => { void addRoom(e) }} className="flex flex-wrap gap-3 items-end">
            <label>Numero camera <input className="form-input" required value={number} onChange={(e) => setNumber(e.target.value)} /></label>
            <button className="btn btn-primary" type="submit" disabled={busy}>Aggiungi camera</button>
          </form>
          <div className="settings-list shell-card">
            {rooms.length === 0 && <p>Nessuna camera configurata.</p>}
            {rooms.map(room => (
              <div key={room.id} className="settings-row">
                <span className="settings-row-main"><strong>Camera {room.room_number}</strong> · {room.active ? 'Attiva' : 'Disattivata'}</span>
                <button type="button" onClick={() => { void toggleRoom(room) }}>
                  {room.active ? 'Disattiva' : 'Attiva'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function CoreStaysPage() {
  const { hotelId, error: accessError } = useCoreHotel()
  const [rooms, setRooms] = useState<Room[]>([])
  const [stays, setStays] = useState<Stay[]>([])
  const [roomId, setRoomId] = useState('')
  const [guestName, setGuestName] = useState('')
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!hotelId) return
    const [roomsResult, staysResult] = await Promise.all([
      hotelDb.from('rooms').select('id,room_number,active').eq('hotel_id', hotelId).order('room_number'),
      hotelDb.from('stays').select('id,room_id,guest_last_name,guest_pin,check_in_at,check_out_at,status,rooms(room_number)')
        .eq('hotel_id', hotelId).eq('status', 'active').order('check_in_at', { ascending: false }),
    ])
    if (roomsResult.error) throw roomsResult.error
    if (staysResult.error) throw staysResult.error
    setRooms(roomsResult.data ?? [])
    setStays((staysResult.data ?? []).map((stay) => ({ ...stay, rooms: Array.isArray(stay.rooms) ? (stay.rooms[0] ?? null) : stay.rooms })) as Stay[])
  }, [hotelId])
  useEffect(() => {
    setRooms([]); setStays([])
    void reload().catch((cause) => setError(errorText(cause)))
  }, [reload])

  async function addStay(event: FormEvent) {
    event.preventDefault()
    if (!hotelId || !roomId || !guestName.trim() || !checkIn || !checkOut) return
    if (new Date(checkOut) <= new Date(checkIn)) {
      setError('Il check-out deve essere successivo al check-in.')
      return
    }
    setBusy(true); setError(null)
    try {
      const payload = {
        room_id: roomId, guest_last_name: guestName.trim(),
        check_in_at: new Date(checkIn).toISOString(), check_out_at: new Date(checkOut).toISOString(),
      }
      const result = editingId
        ? await hotelDb.from('stays').update(payload).eq('hotel_id', hotelId).eq('id', editingId).eq('status', 'active').select('id').maybeSingle()
        : await hotelDb.from('stays').insert({ hotel_id: hotelId, ...payload }).select('id').maybeSingle()
      if (!result.error && !result.data) throw new Error('Operazione non applicata.')
      if (result.error) throw result.error
      resetForm()
      await reload()
    } catch (cause) { setError(errorText(cause)) }
    finally { setBusy(false) }
  }

  function editStay(stay: Stay) {
    setEditingId(stay.id)
    setRoomId(stay.room_id)
    setGuestName(stay.guest_last_name)
    setCheckIn(toLocalDatetime(stay.check_in_at))
    setCheckOut(toLocalDatetime(stay.check_out_at))
    setError(null)
  }

  function resetForm() {
    setEditingId(null)
    setRoomId('')
    setGuestName('')
    setCheckIn('')
    setCheckOut('')
  }

  async function extendStay(stay: Stay) {
    const proposed = window.prompt('Nuova data e ora di check-out (AAAA-MM-GGTHH:mm)', toLocalDatetime(stay.check_out_at))
    if (proposed === null) return
    const next = new Date(proposed)
    if (!proposed || Number.isNaN(next.getTime()) || next <= new Date(stay.check_out_at)) {
      setError('La nuova data di check-out deve essere successiva a quella attuale.')
      return
    }
    setError(null)
    try {
      const result = await hotelDb.from('stays').update({ check_out_at: next.toISOString() })
        .eq('hotel_id', hotelId!).eq('id', stay.id).eq('status', 'active').select('id').maybeSingle()
      if (result.error) throw result.error
      if (!result.data) throw new Error('Estensione non applicata.')
      await reload()
    } catch (cause) { setError(errorText(cause)) }
  }

  async function changeStatus(stay: Stay, status: 'closed' | 'cancelled') {
    if (!hotelId || !window.confirm(status === 'closed' ? 'Confermare il check-out?' : 'Annullare il soggiorno?')) return
    setError(null)
    try {
      const result = await hotelDb.from('stays')
        .update(status === 'closed' ? { status, check_out_at: new Date().toISOString() } : { status })
        .eq('hotel_id', hotelId).eq('id', stay.id).select('id').maybeSingle()
      if (result.error) throw result.error
      if (!result.data) throw new Error('Aggiornamento non applicato.')
      await reload()
    } catch (cause) { setError(errorText(cause)) }
  }

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Hotel Core" title="Soggiorni" description="Gestione condivisa dei soggiorni, anche senza Housekeeping." />
      <CoreNavigation />
      {accessError && <p role="alert">{accessError}</p>}
      {error && <p role="alert">{error}</p>}
      {hotelId && (
        <>
          <form onSubmit={(e) => { void addStay(e) }} className="shell-card p-4 grid gap-3">
            <label>Camera
              <select required value={roomId} onChange={e => setRoomId(e.target.value)}>
                <option value="">Seleziona camera</option>
                {rooms.filter(room => room.active).map(room => <option key={room.id} value={room.id}>{room.room_number}</option>)}
              </select>
            </label>
            <label>Cognome ospite <input required value={guestName} onChange={e => setGuestName(e.target.value)} /></label>
            <label>Check-in <input type="datetime-local" required value={checkIn} onChange={e => setCheckIn(e.target.value)} /></label>
            <label>Check-out <input type="datetime-local" required value={checkOut} onChange={e => setCheckOut(e.target.value)} /></label>
            <div className="flex gap-2">
              <button className="btn btn-primary" type="submit" disabled={busy}>{editingId ? 'Salva soggiorno' : 'Attiva soggiorno'}</button>
              {editingId && <button type="button" onClick={resetForm}>Annulla modifica</button>}
            </div>
          </form>
          <div className="settings-list shell-card">
            {stays.length === 0 && <p>Nessun soggiorno attivo.</p>}
            {stays.map(stay => (
              <div key={stay.id} className="settings-row flex-wrap gap-3">
                <span className="settings-row-main">
                  <strong>Camera {stay.rooms?.room_number ?? '—'} · {stay.guest_last_name}</strong>
                  <small>{new Date(stay.check_in_at).toLocaleString('it-IT')} – {new Date(stay.check_out_at).toLocaleString('it-IT')}</small>
                  <small>PIN ospite: {stay.guest_pin}</small>
                </span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => editStay(stay)}>Modifica</button>
                  <button type="button" onClick={() => { void extendStay(stay) }}>Estendi</button>
                  <button type="button" onClick={() => { void changeStatus(stay, 'closed') }}>Check-out</button>
                  <button type="button" onClick={() => { void changeStatus(stay, 'cancelled') }}>Annulla</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

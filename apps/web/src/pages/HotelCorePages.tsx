import type { SupabaseClient } from '@supabase/supabase-js'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, DatePicker, Modal, ModuleNav, TimePicker } from '@homisuite/ui'
import { BedDouble, ChevronDown, Eye, EyeOff, Pencil, Plus, Power, Trash2, Upload, Users } from 'lucide-react'
import { Select } from '../components/Select'
import { Switch } from '../components/Switch'
import { useConfirm } from '../components/ConfirmDialog'
import { PageState } from '../components/PageState'
import { supabase } from '../core/client'
import { useModuleRuntime } from '../core/ModuleRuntimeContext'
import { parseOperaArrivals, operaDateToLocalValue } from '../lib/operaImport'

// The Core SDK schema currently models only Core tables; the existing
// legacy rooms/stays tables and new bridge RPC are not yet in its type map.
// Keep this compatibility client local until schema types are regenerated.
const hotelDb = supabase as unknown as SupabaseClient

type Room = { id: string; room_number: string; active: boolean }
type Stay = {
  id: string
  room_id: string
  guest_last_name: string
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

// "Local wall-clock string" (YYYY-MM-DDTHH:mm) <-> the separate date/time
// values DatePicker/TimePicker take -- same split/join shape Housekeeping's
// own Soggiorni already uses, and what operaDateToLocalValue below already
// produces.
function splitLocal(value: string): { date: string; time: string } {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value)
  return match ? { date: match[1]!, time: match[2]! } : { date: '', time: '' }
}
function joinLocal(date: string, time: string): string {
  return date ? `${date}T${time || '00:00'}` : ''
}
function toLocal(iso: string): string {
  const date = new Date(iso)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

function useCoreHotel() {
  const runtime = useModuleRuntime()
  const [hotelId, setHotelId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    setHotelId(null)
    setError(null)
    setLoading(true)
    if (!runtime.property) { setLoading(false); return }
    // This Core RPC checks property permissions without guest_requests.
    void hotelDb.rpc('core_hotel_id_for_property', { p_property_id: runtime.property.id })
      .then(({ data, error: rpcError }) => {
        if (!active) return
        if (rpcError) setError(rpcError.message)
        else if (typeof data === 'string') setHotelId(data)
        else setError('La struttura non è collegata a un hotel Core o non hai i permessi necessari.')
        setLoading(false)
      })
    return () => { active = false }
  }, [runtime.property?.id])
  return { hotelId, error, loading }
}

// Renders ModuleNav the same way every other module does (Dining, Turni,
// Housekeeping): the suite's one shared top-nav-with-tabs component, not a
// bespoke row of links. `items`' values are real routes here, matched
// against the current URL rather than internal state -- same pattern
// Housekeeping's own EmbeddedNav uses to drive a ModuleNav with a router.
// Exported so TeamPage renders the exact same tab bar -- Team, Camere and
// Soggiorni are one section ("Struttura e Team") from the sidebar down,
// not three independently-headed pages that happen to link to each other.
export function useStructureNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const items = [
    { value: '/team', label: 'Team', icon: <Users /> },
    { value: '/settings/rooms', label: 'Camere', icon: <BedDouble /> },
    { value: '/settings/stays', label: 'Soggiorni', icon: <Power /> },
  ]
  const value = items.find((item) => location.pathname === item.value)?.value ?? '/team'
  return { items, value, onValueChange: (next: string) => navigate(next) }
}

type OperaDraft = { key: string; roomId: string; guestName: string; checkIn: string; checkOut: string; include: boolean }

function CoreOperaImport({ hotelId, rooms, onImported }: { hotelId: string; rooms: Room[]; onImported: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [drafts, setDrafts] = useState<OperaDraft[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function readFile(file: File | undefined) {
    if (!file) return
    setError(null); setResult(null)
    try {
      const parsed = parseOperaArrivals(await file.text())
      setWarnings(parsed.warnings)
      setDrafts(parsed.rows.map((row, i) => {
        const roomId = rooms.find((room) => room.active && room.room_number === row.roomNumber)?.id ?? ''
        return { key: String(i), roomId, guestName: row.guestName, checkIn: operaDateToLocalValue(row.arrivalDate, '15:00'), checkOut: operaDateToLocalValue(row.departureDate, '11:00'), include: Boolean(roomId) }
      }))
    } catch (cause) { setError(errorText(cause)) }
  }
  function update(key: string, patch: Partial<OperaDraft>) {
    setDrafts((current) => current.map((d) => (d.key === key ? { ...d, ...patch } : d)))
  }
  async function importSelected() {
    setBusy(true); setError(null); setResult(null)
    let ok = 0; let failed = 0
    for (const draft of drafts.filter((d) => d.include)) {
      const start = new Date(draft.checkIn)
      const end = new Date(draft.checkOut)
      if (!draft.roomId || !draft.guestName.trim() || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) { failed++; continue }
      const response = await hotelDb.from('stays').insert({
        hotel_id: hotelId, room_id: draft.roomId, guest_last_name: draft.guestName.trim(),
        check_in_at: start.toISOString(), check_out_at: end.toISOString(),
      })
      if (response.error) failed++
      else ok++
    }
    setBusy(false)
    setResult(`Importati: ${ok}. Non importati: ${failed}.`)
    if (ok) await onImported().catch((cause) => setError(errorText(cause)))
    setDrafts([])
  }

  return (
    <section className="shell-card">
      <div
        className="section-heading split"
        style={{ cursor: 'pointer' }}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v) } }}
      >
        <div><h2>Importa soggiorni da Opera</h2><p>Carica un report arrivi Opera in formato testo delimitato. Controlla camere, ospiti e date prima di importare.</p></div>
        <ChevronDown size={18} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .2s' }} aria-hidden="true" />
      </div>
      {open ? (
        <div style={{ padding: '0 20px 20px' }}>
          <input ref={fileInputRef} aria-label="Report Opera" type="file" accept=".txt,.csv,text/plain" hidden onChange={(e) => { void readFile(e.target.files?.[0]) }} />
          <Button variant="secondary" onClick={() => fileInputRef.current?.click()}><Upload size={15} /> Carica report</Button>
          {warnings.length > 0 ? <p className="muted" role="status" style={{ marginTop: 10 }}>{warnings.length} righe del report richiedono attenzione.</p> : null}
          {drafts.length > 0 ? (
            <div className="page-stack" style={{ marginTop: 14, gap: 10 }}>
              {drafts.map((d) => {
                const checkIn = splitLocal(d.checkIn)
                const checkOut = splitLocal(d.checkOut)
                return (
                  <div className="dining-field-grid" key={d.key} style={{ alignItems: 'end', padding: 12, border: '1px solid var(--line)', borderRadius: 'var(--r-sm)' }}>
                    <label className="form-field switch-field"><span>Importa</span><Switch checked={d.include} onChange={() => update(d.key, { include: !d.include })} aria-label={`Importa riga ${d.guestName}`} /></label>
                    <label className="form-field"><span>Camera</span>
                      <Select name={`opera-room-${d.key}`} value={d.roomId} onChange={(v) => update(d.key, { roomId: v })}>
                        <option value="">Non assegnata</option>
                        {rooms.filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.room_number}</option>)}
                      </Select>
                    </label>
                    <label className="form-field"><span>Ospite</span><input value={d.guestName} onChange={(e) => update(d.key, { guestName: e.target.value })} /></label>
                    <label className="form-field"><span>Check-in</span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <DatePicker value={checkIn.date} onChange={(v) => update(d.key, { checkIn: joinLocal(v, checkIn.time) })} ariaLabel="Data check-in" />
                        <TimePicker value={checkIn.time} onChange={(v) => update(d.key, { checkIn: joinLocal(checkIn.date, v) })} ariaLabel="Ora check-in" />
                      </div>
                    </label>
                    <label className="form-field"><span>Check-out</span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <DatePicker value={checkOut.date} onChange={(v) => update(d.key, { checkOut: joinLocal(v, checkOut.time) })} ariaLabel="Data check-out" />
                        <TimePicker value={checkOut.time} onChange={(v) => update(d.key, { checkOut: joinLocal(checkOut.date, v) })} ariaLabel="Ora check-out" />
                      </div>
                    </label>
                  </div>
                )
              })}
              <Button variant="primary" disabled={busy || !drafts.some((d) => d.include)} onClick={() => { void importSelected() }} style={{ justifySelf: 'start' }}>
                {busy ? 'Importazione…' : 'Conferma importazione'}
              </Button>
            </div>
          ) : null}
          {result ? <p role="status" style={{ marginTop: 10 }}>{result}</p> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </div>
      ) : null}
    </section>
  )
}

export function CoreRoomsPage() {
  const runtime = useModuleRuntime()
  const nav = useStructureNav()
  const { hotelId, error: accessError, loading } = useCoreHotel()
  const [rooms, setRooms] = useState<Room[]>([])
  const [number, setNumber] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDialog, confirm] = useConfirm()

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

  async function deleteRoom(room: Room) {
    if (!hotelId) return
    const ok = await confirm({
      title: `Eliminare la camera ${room.room_number}?`,
      description: 'Le camere con soggiorni registrati verranno solo disattivate.',
      confirmLabel: 'Elimina',
    })
    if (!ok) return
    setError(null)
    try {
      const result = await hotelDb.from('rooms').delete().eq('hotel_id', hotelId).eq('id', room.id).select('id')
      if (result.error?.code === '23503') {
        const disabled = await hotelDb.from('rooms').update({ active: false }).eq('hotel_id', hotelId).eq('id', room.id).select('id').maybeSingle()
        if (disabled.error) throw disabled.error
        if (!disabled.data) throw new Error('Camera non aggiornata.')
      } else {
        if (result.error) throw result.error
        if (!result.data?.length) throw new Error('Camera non eliminata.')
      }
      await reload()
    } catch (cause) { setError(errorText(cause)) }
  }

  async function toggleRoom(room: Room) {
    if (room.active) {
      const ok = await confirm({ title: `Disattivare la camera ${room.room_number}?`, confirmLabel: 'Disattiva' })
      if (!ok) return
    }
    setError(null)
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
      <ModuleNav propertyName={runtime.property?.name ?? 'Struttura'} moduleName="Struttura e Team" items={nav.items} value={nav.value} onValueChange={nav.onValueChange} ariaLabel="Struttura e Team" />
      {loading ? <PageState kind="loading" title="Verifica accesso alla struttura…" /> : null}
      {accessError ? <PageState kind="error" title="Impossibile accedere a Struttura e Team." description={accessError} /> : null}
      {error ? <div className="shell-alert error" role="alert">{error}</div> : null}
      {hotelId ? (
        <section className="shell-card">
          <div className="section-heading split">
            <div><h2>Camere</h2><p>Inventario condiviso, indipendente dai moduli attivi.</p></div>
          </div>
          <form onSubmit={(e) => { void addRoom(e) }} className="dining-field-grid" style={{ padding: '0 20px 16px', alignItems: 'end' }}>
            <label className="form-field"><span>Numero camera</span><input required value={number} onChange={(e) => setNumber(e.target.value)} /></label>
            <Button variant="primary" type="submit" disabled={busy} style={{ justifySelf: 'start' }}><Plus size={15} /> Aggiungi camera</Button>
          </form>
          <div className="settings-list">
            {rooms.length === 0 ? <PageState kind="empty" icon={BedDouble} title="Nessuna camera configurata." /> : null}
            {rooms.map((room) => (
              <div key={room.id} className="settings-row settings-row-static">
                <span className="settings-row-main"><span className="settings-row-icon"><BedDouble size={17} /></span><span><strong>Camera {room.room_number}</strong><small>{room.active ? 'Attiva' : 'Disattivata'}</small></span></span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Switch checked={room.active} onChange={() => { void toggleRoom(room) }} aria-label={`Attiva/disattiva camera ${room.room_number}`} />
                  <button className="row-action danger" type="button" onClick={() => { void deleteRoom(room) }} aria-label={`Elimina camera ${room.room_number}`} title="Elimina"><Trash2 size={15} /></button>
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {confirmDialog}
    </div>
  )
}

export function CoreStaysPage() {
  const runtime = useModuleRuntime()
  const nav = useStructureNav()
  const { hotelId, error: accessError, loading } = useCoreHotel()
  const [rooms, setRooms] = useState<Room[]>([])
  const [stays, setStays] = useState<Stay[]>([])
  const [roomId, setRoomId] = useState('')
  const [guestName, setGuestName] = useState('')
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [revealedPins, setRevealedPins] = useState<Record<string, string>>({})
  const [extending, setExtending] = useState<Stay | null>(null)
  const [extendValue, setExtendValue] = useState('')
  const [extendError, setExtendError] = useState<string | null>(null)
  const [confirmDialog, confirm] = useConfirm()

  const reload = useCallback(async () => {
    if (!hotelId) return
    const [roomsResult, staysResult] = await Promise.all([
      hotelDb.from('rooms').select('id,room_number,active').eq('hotel_id', hotelId).order('room_number'),
      hotelDb.from('stays').select('id,room_id,guest_last_name,check_in_at,check_out_at,status,rooms(room_number)')
        .eq('hotel_id', hotelId).eq('status', 'active').order('check_in_at', { ascending: false }),
    ])
    if (roomsResult.error) throw roomsResult.error
    if (staysResult.error) throw staysResult.error
    setRevealedPins({})
    setRooms(roomsResult.data ?? [])
    setStays((staysResult.data ?? []).map((stay) => ({ ...stay, rooms: Array.isArray(stay.rooms) ? (stay.rooms[0] ?? null) : stay.rooms })) as Stay[])
  }, [hotelId])
  useEffect(() => {
    setRooms([]); setStays([])
    void reload().catch((cause) => setError(errorText(cause)))
  }, [reload])

  async function togglePin(stay: Stay) {
    if (revealedPins[stay.id] !== undefined) {
      setRevealedPins((current) => {
        const next = { ...current }
        delete next[stay.id]
        return next
      })
      return
    }
    if (!hotelId) return
    setError(null)
    try {
      const result = await hotelDb.from('stays').select('guest_pin')
        .eq('hotel_id', hotelId).eq('id', stay.id).eq('status', 'active').maybeSingle()
      if (result.error) throw result.error
      if (!result.data) throw new Error('Soggiorno non disponibile.')
      const pin = String(result.data.guest_pin ?? '')
      setRevealedPins((current) => ({ ...current, [stay.id]: pin }))
    } catch (cause) { setError(errorText(cause)) }
  }

  async function addStay(event: FormEvent) {
    event.preventDefault()
    if (!hotelId || !roomId || !guestName.trim() || !checkIn || !checkOut) return
    if (!Number.isFinite(new Date(checkIn).getTime()) || !Number.isFinite(new Date(checkOut).getTime()) || new Date(checkOut) <= new Date(checkIn)) {
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
      if (result.error) throw result.error
      if (!result.data) throw new Error('Operazione non applicata.')
      resetForm()
      await reload()
    } catch (cause) { setError(errorText(cause)) }
    finally { setBusy(false) }
  }

  function editStay(stay: Stay) {
    setEditingId(stay.id)
    setRoomId(stay.room_id)
    setGuestName(stay.guest_last_name)
    setCheckIn(toLocal(stay.check_in_at))
    setCheckOut(toLocal(stay.check_out_at))
    setError(null)
  }

  function resetForm() {
    setEditingId(null)
    setRoomId('')
    setGuestName('')
    setCheckIn('')
    setCheckOut('')
  }

  function openExtend(stay: Stay) {
    setExtending(stay)
    setExtendValue(toLocal(stay.check_out_at))
    setExtendError(null)
  }

  async function confirmExtend() {
    if (!extending || !hotelId) return
    const next = new Date(extendValue)
    if (!extendValue || Number.isNaN(next.getTime()) || next <= new Date(extending.check_out_at)) {
      setExtendError('La nuova data di check-out deve essere successiva a quella attuale.')
      return
    }
    try {
      const result = await hotelDb.from('stays').update({ check_out_at: next.toISOString() })
        .eq('hotel_id', hotelId).eq('id', extending.id).eq('status', 'active').select('id').maybeSingle()
      if (result.error) throw result.error
      if (!result.data) throw new Error('Estensione non applicata.')
      setExtending(null)
      await reload()
    } catch (cause) { setExtendError(errorText(cause)) }
  }

  async function changeStatus(stay: Stay, status: 'closed' | 'cancelled') {
    if (!hotelId) return
    const ok = await confirm({
      title: status === 'closed' ? 'Confermare il check-out?' : 'Annullare il soggiorno?',
      confirmLabel: status === 'closed' ? 'Check-out' : 'Annulla soggiorno',
    })
    if (!ok) return
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

  const checkInSplit = splitLocal(checkIn)
  const checkOutSplit = splitLocal(checkOut)
  const extendSplit = splitLocal(extendValue)

  return (
    <div className="page-stack">
      <ModuleNav propertyName={runtime.property?.name ?? 'Struttura'} moduleName="Struttura e Team" items={nav.items} value={nav.value} onValueChange={nav.onValueChange} ariaLabel="Struttura e Team" />
      {loading ? <PageState kind="loading" title="Verifica accesso alla struttura…" /> : null}
      {accessError ? <PageState kind="error" title="Impossibile accedere a Struttura e Team." description={accessError} /> : null}
      {error ? <div className="shell-alert error" role="alert">{error}</div> : null}
      {hotelId ? (
        <>
          <CoreOperaImport hotelId={hotelId} rooms={rooms} onImported={reload} />
          <section className="shell-card">
            <div className="section-heading split">
              <div><h2>{editingId ? 'Modifica soggiorno' : 'Attiva soggiorno'}</h2><p>Gestione condivisa dei soggiorni, anche senza Housekeeping.</p></div>
            </div>
            <form onSubmit={(e) => { void addStay(e) }} className="dining-field-grid" style={{ padding: '0 20px 20px', alignItems: 'end' }}>
              <label className="form-field"><span>Camera</span>
                <Select name="stay-room" value={roomId} onChange={setRoomId} required>
                  <option value="">Seleziona camera</option>
                  {rooms.filter((room) => room.active || room.id === roomId).map((room) => <option key={room.id} value={room.id}>{room.room_number}</option>)}
                </Select>
              </label>
              <label className="form-field"><span>Cognome ospite</span><input required value={guestName} onChange={(e) => setGuestName(e.target.value)} /></label>
              <label className="form-field"><span>Check-in</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <DatePicker value={checkInSplit.date} onChange={(v) => setCheckIn(joinLocal(v, checkInSplit.time))} ariaLabel="Data check-in" />
                  <TimePicker value={checkInSplit.time} onChange={(v) => setCheckIn(joinLocal(checkInSplit.date, v))} ariaLabel="Ora check-in" />
                </div>
              </label>
              <label className="form-field"><span>Check-out</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <DatePicker value={checkOutSplit.date} onChange={(v) => setCheckOut(joinLocal(v, checkOutSplit.time))} ariaLabel="Data check-out" />
                  <TimePicker value={checkOutSplit.time} onChange={(v) => setCheckOut(joinLocal(checkOutSplit.date, v))} ariaLabel="Ora check-out" />
                </div>
              </label>
              <div className="span2" style={{ display: 'flex', gap: 10 }}>
                <Button variant="primary" type="submit" disabled={busy}>{editingId ? 'Salva soggiorno' : 'Attiva soggiorno'}</Button>
                {editingId ? <Button variant="secondary" type="button" onClick={resetForm}>Annulla modifica</Button> : null}
              </div>
            </form>
          </section>
          <section className="shell-card">
            <div className="section-heading split"><div><h2>Soggiorni attivi</h2></div></div>
            <div className="settings-list">
              {stays.length === 0 ? <PageState kind="empty" title="Nessun soggiorno attivo." /> : null}
              {stays.map((stay) => (
                <div key={stay.id} className="settings-row settings-row-static" style={{ flexWrap: 'wrap', alignItems: 'flex-start', gap: 10 }}>
                  <span className="settings-row-main">
                    <span><strong>Camera {stay.rooms?.room_number ?? '—'} · {stay.guest_last_name}</strong>
                      <small>{new Date(stay.check_in_at).toLocaleString('it-IT')} – {new Date(stay.check_out_at).toLocaleString('it-IT')}</small>
                      <small style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        PIN ospite: <span style={{ fontFamily: 'var(--mono)' }}>{revealedPins[stay.id] ?? '••••'}</span>
                        <button className="row-action" type="button" onClick={() => { void togglePin(stay) }} aria-label={revealedPins[stay.id] !== undefined ? 'Nascondi PIN' : 'Mostra PIN'} title={revealedPins[stay.id] !== undefined ? 'Nascondi PIN' : 'Mostra PIN'}>
                          {revealedPins[stay.id] !== undefined ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </small>
                    </span>
                  </span>
                  <span style={{ display: 'flex', gap: 2 }}>
                    <button className="row-action" type="button" onClick={() => editStay(stay)} aria-label={`Modifica soggiorno di ${stay.guest_last_name}`} title="Modifica"><Pencil size={15} /></button>
                    <Button variant="secondary" size="sm" onClick={() => openExtend(stay)}>Estendi</Button>
                    <Button variant="secondary" size="sm" onClick={() => { void changeStatus(stay, 'closed') }}>Check-out</Button>
                    <Button variant="danger" size="sm" onClick={() => { void changeStatus(stay, 'cancelled') }}>Annulla</Button>
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
      <Modal
        open={Boolean(extending)}
        title={extending ? `Estendi il soggiorno — Camera ${extending.rooms?.room_number ?? ''}` : 'Estendi soggiorno'}
        description="Imposta la nuova data e ora di check-out."
        onClose={() => setExtending(null)}
        footer={<><Button variant="secondary" onClick={() => setExtending(null)}>Annulla</Button><Button variant="primary" onClick={() => { void confirmExtend() }}>Salva</Button></>}
      >
        <div className="modal-form">
          <label className="form-field"><span>Nuovo check-out</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <DatePicker value={extendSplit.date} onChange={(v) => setExtendValue(joinLocal(v, extendSplit.time))} ariaLabel="Nuova data check-out" />
              <TimePicker value={extendSplit.time} onChange={(v) => setExtendValue(joinLocal(extendSplit.date, v))} ariaLabel="Nuova ora check-out" />
            </div>
          </label>
          {extendError ? <p className="form-error" role="alert">{extendError}</p> : null}
        </div>
      </Modal>
      {confirmDialog}
    </div>
  )
}

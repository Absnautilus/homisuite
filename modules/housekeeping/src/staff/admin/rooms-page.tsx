import { useEffect, useState } from 'react'
import { PageHeader } from '@homisuite/ui'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Trash2 } from 'lucide-react'
import { FieldError, FieldGroup, Input, Label } from '@/components/ui/field'
import { SwitchControl } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableFrame,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/table'
import { createRoom, deleteRoom, listRooms, setRoomActive, type Room } from '@/lib/admin-api'
import { useConfirm } from '@/components/confirm-dialog'
import { useToast } from '@/components/toast-context'
import { useLocale } from '@/lib/i18n/locale-context'
import { useHotelName } from '@/lib/hotel-branding-context'

export function RoomsPage({ hotelId }: { hotelId: string }) {
  const { t } = useLocale()
  const hotelName = useHotelName()
  const { push } = useToast()
  const [rooms, setRooms] = useState<Room[] | null>(null)
  const [hiddenRoomIds, setHiddenRoomIds] = useState<Set<string>>(new Set())
  const [roomNumber, setRoomNumber] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [confirmDialog, confirm] = useConfirm()
  const visibleRooms = rooms?.filter((room) => !hiddenRoomIds.has(room.id)) ?? null

  async function reload() {
    setRooms(await listRooms(hotelId))
  }

  useEffect(() => {
    reload().catch(() => setError(t('staff.rooms.loadError')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId])

  async function onToggle(room: Room) {
    if (room.active) {
      const ok = await confirm({
        title: t('staff.rooms.deactivateTitle'),
        description: t('staff.rooms.deactivateDesc', { room: room.room_number }),
        confirmLabel: t('staff.rooms.deactivateConfirm'),
      })
      if (!ok) return
    }
    setError(null)
    const next = !room.active
    setRooms((current) => current?.map((r) => (r.id === room.id ? { ...r, active: next } : r)) ?? current)
    try {
      await setRoomActive(room.id, next)
      push(t(next ? 'common.toast.activated' : 'common.toast.deactivated'), 'success')
    } catch {
      setRooms((current) => current?.map((r) => (r.id === room.id ? { ...r, active: room.active } : r)) ?? current)
      setError(t('staff.rooms.toggleError'))
    }
  }

  // A room with recorded stays is kept by the FK guard (see deleteRoom's
  // comment) -- that's an expected outcome. From the person clicking
  // "Elimina" it should still behave like a delete: the row leaves the
  // list right away. It used to just vanish from view without the
  // underlying room being touched at all, so it would reappear, still
  // active, on the next reload -- the actual bug being fixed here. Now the
  // room is deactivated for real first (the intended guardrail, per
  // deleteRoom's own comment), so a reload shows it correctly as inactive
  // rather than resurrecting it active. Any other failure (e.g. blocked by
  // RLS) is a real error and must be surfaced instead of leaving the room
  // silently un-deleted.
  async function onDelete(room: Room) {
    const ok = await confirm({
      title: t('staff.rooms.deleteTitle'),
      description: t('staff.rooms.deleteDesc', { room: room.room_number }),
      confirmLabel: t('staff.rooms.deleteConfirm'),
    })
    if (!ok) return
    setError(null)
    try {
      await deleteRoom(room.id)
      setHiddenRoomIds((current) => new Set(current).add(room.id))
      push(t('common.toast.removed'), 'success')
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === '23503') {
        try {
          await setRoomActive(room.id, false)
          setRooms((current) => current?.map((r) => (r.id === room.id ? { ...r, active: false } : r)) ?? current)
          setHiddenRoomIds((current) => new Set(current).add(room.id))
          setError(t('staff.rooms.deleteBlockedDeactivated'))
        } catch {
          setError(t('staff.rooms.deleteError'))
        }
        return
      }
      setError(t('staff.rooms.deleteError'))
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      await createRoom(roomNumber.trim())
      setRoomNumber('')
      await reload()
    } catch {
      setError(t('staff.rooms.addError'))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-6">
      {confirmDialog}
      <PageHeader eyebrow={hotelName} title={t('staff.rooms.title')} description={t('staff.rooms.subtitle')} />

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-foreground">{t('staff.rooms.addTitle')}</h2>
        </CardHeader>
        <CardBody>
          <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <FieldGroup className="mb-0 min-w-0 flex-1">
              <Label htmlFor="roomNumber" required>
                {t('staff.rooms.roomNumber')}
              </Label>
              <Input id="roomNumber" required value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} />
            </FieldGroup>
            <Button type="submit" disabled={pending} className="w-full sm:w-auto">
              {t('staff.rooms.add')}
            </Button>
          </form>
          <FieldError>{error ?? undefined}</FieldError>
        </CardBody>
      </Card>

      {rooms === null ? (
        <p role="status" className="text-sm text-muted">{t('staff.rooms.loading')}</p>
      ) : (
        <TableFrame>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>{t('staff.rooms.colRoom')}</TableHeaderCell>
                <TableHeaderCell className="w-px"><span className="sr-only">{t('staff.rooms.colStatus')}</span></TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {visibleRooms?.map((room) => (
                <TableRow key={room.id}>
                  <TableCell className="font-medium text-foreground">{room.room_number}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <SwitchControl
                        checked={room.active}
                        onCheckedChange={() => onToggle(room)}
                        aria-label={room.active ? t('staff.rooms.deactivate') : t('staff.rooms.reactivate')}
                      />
                      <IconButton
                        tone="danger"
                        icon={Trash2}
                        label={t('staff.rooms.delete')}
                        onClick={() => onDelete(room)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableFrame>
      )}
    </div>
  )
}

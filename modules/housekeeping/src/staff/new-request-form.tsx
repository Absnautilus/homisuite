import { useEffect, useMemo, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { FieldError, FieldGroup, Label, Select, Textarea } from '@/components/ui/field'
import { ItemCombobox } from '@/components/item-combobox'
import { listMenu, listRooms, type Room } from '@/lib/admin-api'
import { createStaffRequest } from '@/lib/staff-api'
import { useLocale } from '@/lib/i18n/locale-context'
import { getErrorMessage, tenantIntegrityErrorRef } from '@/lib/errors'
import type { RequestCategoryAdmin, RequestTypeAdmin } from '@/lib/admin-api'

export function NewRequestForm({ staffId, hotelId, onCreated }: { staffId: string; hotelId: string; onCreated: () => void }) {
  const { t } = useLocale()
  const [open, setOpen] = useState(false)
  const [rooms, setRooms] = useState<Room[]>([])
  const [categories, setCategories] = useState<RequestCategoryAdmin[]>([])
  const [types, setTypes] = useState<RequestTypeAdmin[]>([])
  const [roomId, setRoomId] = useState('')
  const [typeId, setTypeId] = useState('')
  const [note, setNote] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    Promise.all([listRooms(hotelId), listMenu(hotelId)]).then(([roomList, menu]) => {
      const activeRooms = roomList.filter((r) => r.active)
      setRooms(activeRooms)
      setRoomId((c) => c || (activeRooms[0]?.id ?? ''))
      setCategories(menu.categories.filter((c) => c.active))
      setTypes(menu.types.filter((t) => t.active))
    })
  }, [open, hotelId])

  const selectedType = useMemo(() => types.find((t) => t.id === typeId) ?? null, [types, typeId])

  useEffect(() => {
    setQuantity(1)
  }, [typeId])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const room = rooms.find((r) => r.id === roomId)
    if (!room || !typeId) return
    setPending(true)
    setError(null)
    try {
      await createStaffRequest({ hotelId, roomNumber: room.room_number, requestTypeId: typeId, quantity: selectedType?.allows_quantity ? quantity : null, note: note.trim() || null, staffId })
      setNote('')
      setOpen(false)
      onCreated()
    } catch (err) {
      const ref = tenantIntegrityErrorRef(err)
      setError(ref ? t('staff.newRequest.tenantMismatchError', { ref }) : getErrorMessage(err) || t('staff.newRequest.error'))
    } finally {
      setPending(false)
    }
  }

  if (!open) {
    return (
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus size={16} />
        {t('staff.newRequest.toggle')}
      </Button>
    )
  }

  return (
    <Card className="mb-5 w-full">
      <CardHeader>
        <h2 className="text-sm font-semibold text-foreground">{t('staff.newRequest.title')}</h2>
      </CardHeader>
      <CardBody>
        <form onSubmit={onSubmit}>
          <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-[140px_1fr]">
            <FieldGroup>
              <Label htmlFor="sr-room" required>
                {t('staff.newRequest.room')}
              </Label>
              <Select id="sr-room" required value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.room_number}
                  </option>
                ))}
              </Select>
            </FieldGroup>
            <FieldGroup>
              <Label htmlFor="sr-type" required>
                {t('staff.newRequest.what')}
              </Label>
              <ItemCombobox
                id="sr-type"
                items={types}
                categories={categories}
                value={typeId}
                onChange={setTypeId}
                required
                placeholder={t('staff.newRequest.whatPlaceholder')}
              />
            </FieldGroup>
          </div>
          {selectedType?.allows_quantity && (
            <FieldGroup>
              <Label>{t('flow.quantity')}</Label>
              <div className="flex h-11 w-fit items-center gap-2 rounded-sm border border-line bg-surface px-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={quantity <= 1}
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  aria-label={`${t('flow.quantity')} -`}
                  className="h-8 w-8 px-0"
                >
                  <Minus size={14} />
                </Button>
                <span className="w-8 text-center text-sm font-semibold tabular-nums">{quantity}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={quantity >= 10}
                  onClick={() => setQuantity((q) => Math.min(10, q + 1))}
                  aria-label={`${t('flow.quantity')} +`}
                  className="h-8 w-8 px-0"
                >
                  <Plus size={14} />
                </Button>
              </div>
            </FieldGroup>
          )}
          <FieldGroup>
            <Label htmlFor="sr-note">{t('staff.newRequest.notes')}</Label>
            <Textarea id="sr-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('staff.newRequest.notesPlaceholder')} />
          </FieldGroup>
          <FieldError>{error ?? undefined}</FieldError>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t('staff.newRequest.cancel')}
            </Button>
            <Button type="submit" disabled={pending || !roomId || !typeId}>
              {pending ? t('staff.newRequest.submitPending') : t('staff.newRequest.submit')}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  )
}

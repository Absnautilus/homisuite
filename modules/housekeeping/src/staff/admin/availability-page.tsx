import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { AutoText } from '@/components/auto-text'
import { Table, TableBody, TableCell, TableFrame, TableHead, TableHeaderCell, TableRow } from '@/components/ui/table'
import { fetchItemAvailability, type ItemAvailability } from '@/lib/admin-api'
import { getErrorMessage } from '@/lib/errors'
import { useLocale } from '@/lib/i18n/locale-context'

export function AvailabilityPage({ hotelId }: { hotelId: string }) {
  const { t } = useLocale()
  const [items, setItems] = useState<ItemAvailability[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchItemAvailability(hotelId)
      .then(setItems)
      .catch((err) => {
        console.error(err)
        setError(getErrorMessage(err))
      })
  }, [hotelId])

  return (
    <div className="space-y-6">
      <div className="admin-panel-title"><h2>{t('staff.availability.title')}</h2><p>{t('staff.availability.subtitle')}</p></div>

      {error ? (
        <div role="alert" className="rounded-lg border border-bad-ink/25 bg-bad-bg p-4 text-sm text-bad-ink">{t('staff.availability.loadError')}</div>
      ) : items === null ? (
        <p role="status" className="text-sm text-muted">{t('staff.availability.loading')}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">{t('staff.availability.empty')}</p>
      ) : (
        <TableFrame>
          <Table aria-label={t('staff.availability.title')}>
            <TableHead>
              <tr>
                <TableHeaderCell>{t('staff.availability.colItem')}</TableHeaderCell>
                <TableHeaderCell>{t('staff.availability.colTotal')}</TableHeaderCell>
                <TableHeaderCell>{t('staff.availability.colRemaining')}</TableHeaderCell>
                <TableHeaderCell>{t('staff.availability.colRooms')}</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {items.map((it) => (
                <TableRow key={it.requestTypeId}>
                  <TableCell className="font-medium text-foreground">
                    <AutoText text={it.name} translations={it.name_i18n} />
                    {it.categoryName && (
                      <span className="ml-1.5 text-xs text-muted">
                        · <AutoText text={it.categoryName} translations={it.categoryName_i18n} />
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted">{it.totalQuantity}</TableCell>
                  <TableCell>
                    <Badge className={it.remaining === 0 ? 'bg-bad-bg text-bad-ink' : 'bg-ok-bg text-ok-ink'}>{it.remaining}</Badge>
                  </TableCell>
                  <TableCell className="text-muted">
                    {it.rooms.length === 0 ? '—' : it.rooms.map((r) => t('staff.newRequest.room') + ' ' + r).join(', ')}
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

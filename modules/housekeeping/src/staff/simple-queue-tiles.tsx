import type { ReactNode } from 'react'
import { Check, Clock, Inbox } from 'lucide-react'
import { useLocale } from '@/lib/i18n/locale-context'
import { cn } from '@/lib/cn'

type Tab = 'new' | 'inProgress' | 'done'

// Simple mode's stand-in for the new/inProgress/done text tabs: same three
// states, same switch-the-tab behavior, just one big color-coded button per
// state instead of a row of words to read. Reuses the suite's own
// requested/in_progress/completed tone tokens (see ui/badge.tsx) rather than
// inventing a separate palette, so it still reads as the same app.
export function SimpleQueueTiles({
  tab,
  onSelect,
  newCount,
  inProgressCount,
  doneCount,
}: {
  tab: Tab
  onSelect: (tab: Tab) => void
  newCount: number
  inProgressCount: number
  doneCount: number
}) {
  const { t } = useLocale()
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-tour="hk-simple-tiles">
      <Tile
        active={tab === 'new'}
        tone="bg-wait-ink"
        icon={<Inbox className="h-7 w-7" />}
        count={newCount}
        label={t('staff.queue.tabNew')}
        onClick={() => onSelect('new')}
      />
      <Tile
        active={tab === 'inProgress'}
        tone="bg-prog-ink"
        icon={<Clock className="h-7 w-7" />}
        count={inProgressCount}
        label={t('staff.queue.columnInProgress')}
        onClick={() => onSelect('inProgress')}
      />
      <Tile
        active={tab === 'done'}
        tone="bg-done-ink"
        icon={<Check className="h-7 w-7" />}
        count={doneCount}
        label={t('staff.queue.tabDone')}
        onClick={() => onSelect('done')}
      />
    </div>
  )
}

function Tile({
  active,
  tone,
  icon,
  count,
  label,
  onClick,
}: {
  active: boolean
  tone: string
  icon: ReactNode
  count: number
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex cursor-pointer items-center gap-4 rounded-2xl px-5 py-5 text-left text-white transition-opacity',
        tone,
        active ? 'ring-4 ring-offset-2 ring-foreground/30' : 'opacity-85 hover:opacity-100',
      )}
    >
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/20">{icon}</span>
      <span className="min-w-0">
        <span className="block text-3xl leading-none font-extrabold">{count}</span>
        <span className="block text-base leading-tight font-bold">{label}</span>
      </span>
    </button>
  )
}

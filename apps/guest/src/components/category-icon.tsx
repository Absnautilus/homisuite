import { BedDouble, Briefcase, MoreHorizontal, ShowerHead, Sparkles, Wrench, type LucideProps } from 'lucide-react'

// Matches the staff side's own icon set (apps/web, modules/housekeeping),
// which is lucide-react throughout -- previously this was a hand-rolled
// path map that only approximated Lucide's look.
const DEFAULT_ICON = MoreHorizontal

const ICONS: Record<string, typeof BedDouble> = {
  bed: BedDouble,
  shower: ShowerHead,
  sparkles: Sparkles,
  wrench: Wrench,
  briefcase: Briefcase,
  dots: MoreHorizontal,
}

export function CategoryIcon({ icon, ...props }: { icon: string | null } & LucideProps) {
  const Icon = (icon && ICONS[icon]) || DEFAULT_ICON
  return <Icon {...props} />
}

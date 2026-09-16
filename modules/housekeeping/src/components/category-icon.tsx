import { lazy, Suspense, type ComponentType, type SVGProps } from 'react'
import { MoreHorizontal } from 'lucide-react'
import dynamicIconImports from 'lucide-react/dynamicIconImports'

type IconName = keyof typeof dynamicIconImports

// request_categories.icon predates the full Lucide library being pickable
// (see IconPicker) -- these are the original hand-picked short aliases,
// kept resolving forever so categories saved before that existed don't
// need a data migration. Was previously a hand-rolled SVG path map that
// only approximated Lucide's real icons; now renders the real ones,
// matching apps/guest's own CategoryIcon exactly.
const LEGACY_ALIASES: Partial<Record<string, IconName>> = {
  bed: 'bed-double',
  shower: 'shower-head',
  sparkles: 'sparkles',
  wrench: 'wrench',
  briefcase: 'briefcase',
  dots: 'ellipsis',
}

// One lazy component per icon name, shared across every render/instance --
// creating a fresh lazy() per render would re-suspend on every re-render
// instead of resolving once and staying resolved.
const cache = new Map<IconName, ComponentType<SVGProps<SVGSVGElement>>>()

export function resolveIcon(icon: string | null): ComponentType<SVGProps<SVGSVGElement>> | null {
  if (!icon) return null
  const name = (LEGACY_ALIASES[icon] ?? icon) as IconName
  if (!(name in dynamicIconImports)) return null
  if (!cache.has(name)) {
    cache.set(name, lazy(dynamicIconImports[name]))
  }
  return cache.get(name) ?? null
}

export function CategoryIcon({ icon, ...props }: { icon: string | null } & SVGProps<SVGSVGElement>) {
  const Icon = resolveIcon(icon) ?? MoreHorizontal
  return (
    <Suspense fallback={<MoreHorizontal {...props} />}>
      <Icon {...props} />
    </Suspense>
  )
}

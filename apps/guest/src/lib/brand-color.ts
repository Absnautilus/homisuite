import type { CSSProperties } from 'react'
import type { StayInfo } from '@/lib/guest-api'

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

// Hotels can recolor the whole guest app to their own brand (Settings'
// "Colore del marchio") instead of Homisuite's default purple. Only
// --accent needs to be set explicitly here -- the light tints used for
// soft backgrounds/borders are derived from it via color-mix(), at
// roughly the same mix ratios the default palette's own tints already
// sit at (see housekeeping-theme.css), so any hex a hotel picks gets a
// consistent light/dark pairing without asking for a second or third
// color.
export function brandColorStyle(stay: Pick<StayInfo, 'hotel_brand_color'>): CSSProperties {
  const color = stay.hotel_brand_color
  if (!color || !HEX_COLOR_RE.test(color)) return {}
  return {
    '--accent': color,
    '--accent-soft': `color-mix(in srgb, ${color} 12%, white)`,
    '--accent-soft-line': `color-mix(in srgb, ${color} 28%, white)`,
  } as CSSProperties
}

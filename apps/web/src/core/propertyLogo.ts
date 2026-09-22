import type { SupabaseClient } from '@supabase/supabase-js'
import type { Property } from '@homisuite/core-sdk'

const LOGO_BUCKET = 'property-logos'

// Shared with SettingsPage's own logo upload UI: same bucket, same
// <property id>/logo.png path convention, same cache-busting query param
// keyed to the stored logoUpdatedAt timestamp so a just-replaced logo
// doesn't keep showing the previously cached image. Anywhere the property
// needs a visual mark (sidebar, mobile header, ...) reads it from here
// instead of falling back to an initials placeholder when a real logo
// already exists.
export function getPropertyLogoUrl(supabase: SupabaseClient, property: Property | null | undefined): string | null {
  const logoUpdatedAt = typeof property?.settings.logoUpdatedAt === 'string' ? property.settings.logoUpdatedAt : null
  if (!property || !logoUpdatedAt) return null
  return `${supabase.storage.from(LOGO_BUCKET).getPublicUrl(`${property.id}/logo.png`).data.publicUrl}?v=${encodeURIComponent(logoUpdatedAt)}`
}

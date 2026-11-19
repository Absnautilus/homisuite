import type { SupabaseClient } from '@supabase/supabase-js'

// Every table loadLiveShiftData reads that a second admin editing the same
// property could change while this tab is open -- all property-scoped, so
// one channel with one postgres_changes listener per table covers the
// whole read model. Without this, nothing in the Turni module refreshed on
// its own: every save only ever called refreshLiveData() on the tab that
// made it, so a concurrent edit elsewhere was invisible until a manual
// reload -- the same gap already closed for Dining's Prenotazioni, just
// covering the whole model here instead of one list.
const WATCHED_TABLES = [
  'shift_planning_units',
  'shift_codes',
  'shift_unit_members',
  'shift_rule_sets',
  'shifts',
  'shift_month_states',
  'shift_unit_job_titles',
  'shift_staff_profiles',
] as const

export function subscribeToLiveData(supabase: SupabaseClient, propertyId: string, onChange: () => void): () => void {
  let channel = supabase.channel(`shift-live-data-${propertyId}-${crypto.randomUUID()}`)
  for (const table of WATCHED_TABLES) {
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `property_id=eq.${propertyId}` },
      onChange,
    )
  }
  channel.subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}

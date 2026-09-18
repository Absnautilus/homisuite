import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types/database'

export async function getDiningLegacyHotelId(
  client: SupabaseClient<Database>,
  propertyId: string,
): Promise<string | null> {
  // Database is still a hand-maintained pre-Fase-2 type map; keep this one
  // newly-added RPC narrowly typed here until database.ts is regenerated.
  // Call rpc through the Supabase client object so its internal `this`
  // binding is preserved (see getGuestRequestsLegacyHotelId).
  const { data, error } = await client.rpc(
    'legacy_hotel_for_property' as never,
    { p_property_id: propertyId, p_module_slug: 'dining' } as never,
  ) as { data: string | null; error: Error | null }

  if (error) throw error
  return data ?? null
}

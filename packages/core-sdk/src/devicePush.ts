import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types/database'

export interface DevicePushSubscriptionKeys {
  endpoint: string
  p256dh: string
  auth: string
  vapidKeyFingerprint: string | null
}

// Owned by `profiles`, not any module-specific table -- works for any
// signed-in user regardless of module access. Goes through the
// claim_device_push_subscription() RPC rather than a raw upsert: re-
// subscribing the same browser/device is supposed to transfer the row to
// whoever is currently signed in on it (the shared front-desk device case),
// but PostgreSQL's row security also gates an upsert's ON CONFLICT DO
// UPDATE target on the table's own SELECT policy, not just UPDATE -- a raw
// client-side upsert can't do this transfer without broadening that SELECT
// policy and letting any authenticated user read other profiles' push
// endpoints/keys. The RPC is `security definer` and always writes
// auth.uid() itself, so it can do the transfer without widening the
// table's RLS at all (see its migration comment for the full story).
export async function saveDevicePushSubscription(
  client: SupabaseClient<Database>,
  keys: DevicePushSubscriptionKeys,
): Promise<void> {
  const { data: userData } = await client.auth.getUser()
  if (!userData.user) throw new Error('not_authenticated')
  const { error } = await client.rpc('claim_device_push_subscription', {
    p_endpoint: keys.endpoint,
    p_p256dh: keys.p256dh,
    p_auth: keys.auth,
    p_vapid_key_fingerprint: keys.vapidKeyFingerprint,
  })
  if (error) throw error
}

export async function deleteDevicePushSubscription(client: SupabaseClient<Database>, endpoint: string): Promise<void> {
  const { error } = await client.from('device_push_subscriptions').delete().eq('endpoint', endpoint)
  if (error) throw error
}

export async function isDevicePushSubscribed(client: SupabaseClient<Database>, endpoint: string): Promise<boolean> {
  const { data, error } = await client
    .from('device_push_subscriptions')
    .select('id')
    .eq('endpoint', endpoint)
    .maybeSingle()
  if (error) throw error
  return data !== null
}

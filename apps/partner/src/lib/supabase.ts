import { createClient } from '@supabase/supabase-js'

// Plain createClient, not @homisuite/core-sdk's createCoreClient: core-sdk's
// extra methods (getCurrentProfile, getMembership, hasPermission...) are
// all staff-identity concepts (profiles/memberships) that don't apply to a
// service_partner_users account at all -- this app only ever talks to its
// own small set of tables/RPCs directly, the same way apps/guest's own
// lib/supabase.ts does.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

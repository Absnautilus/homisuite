import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0'
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0'
import type { MicrosoftConfig } from './graph.ts'
import { DEFAULT_EFFORT, DEFAULT_MODEL, type Effort } from './ai.ts'

// Everything the Smart Inbox functions need from the environment, read and
// validated in one place so a missing secret fails loudly as
// `server_not_configured` instead of halfway through a Graph call.

export interface SmartInboxConfig {
  supabaseUrl: string
  anonKey: string
  serviceRoleKey: string
  functionsUrl: string
  appUrl: string
  tokenKey: string
  stateSecret: string
  cronSecret: string | null
  anthropicApiKey: string
  model: string
  effort: Effort
  microsoft: MicrosoftConfig
}

export function readConfig(env: Pick<typeof Deno.env, 'get'> = Deno.env): SmartInboxConfig | null {
  const supabaseUrl = env.get('SUPABASE_URL')
  const anonKey = env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = env.get('SUPABASE_SERVICE_ROLE_KEY')
  const appUrl = env.get('SMART_INBOX_APP_URL')
  const tokenKey = env.get('SMART_INBOX_TOKEN_KEY')
  const stateSecret = env.get('SMART_INBOX_STATE_SECRET')
  const anthropicApiKey = env.get('ANTHROPIC_API_KEY')
  const clientId = env.get('SMART_INBOX_MS_CLIENT_ID')
  const clientSecret = env.get('SMART_INBOX_MS_CLIENT_SECRET')
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !appUrl || !tokenKey || !stateSecret || !anthropicApiKey || !clientId || !clientSecret) {
    return null
  }
  const functionsUrl = (env.get('SMART_INBOX_FUNCTIONS_URL') ?? `${supabaseUrl}/functions/v1`).replace(/\/+$/, '')
  const effort = env.get('SMART_INBOX_EFFORT')
  return {
    supabaseUrl,
    anonKey,
    serviceRoleKey,
    functionsUrl,
    appUrl: appUrl.replace(/\/+$/, ''),
    tokenKey,
    stateSecret,
    cronSecret: env.get('SMART_INBOX_CRON_SECRET') ?? null,
    anthropicApiKey,
    model: env.get('SMART_INBOX_MODEL') || DEFAULT_MODEL,
    effort: effort === 'low' || effort === 'medium' || effort === 'high' ? effort : DEFAULT_EFFORT,
    microsoft: {
      clientId,
      clientSecret,
      tenant: env.get('SMART_INBOX_MS_TENANT') || 'organizations',
      redirectUri: `${functionsUrl}/smart-inbox-oauth-callback`,
    },
  }
}

export function adminClient(config: SmartInboxConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function callerClient(config: SmartInboxConfig, authorization: string): SupabaseClient {
  return createClient(config.supabaseUrl, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  })
}

export function anthropicClient(config: SmartInboxConfig): Anthropic {
  return new Anthropic({ apiKey: config.anthropicApiKey })
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function readUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value : null
}

// Resolves the signed-in caller and checks one Smart Inbox capability on a
// property through the caller's own JWT -- has_permission() is evaluated
// as them, so entitlement and role are enforced by the database exactly as
// for RLS.
export async function requirePermission(
  caller: SupabaseClient,
  propertyId: string,
  permission: 'smart_inbox.view' | 'smart_inbox.manage',
): Promise<{ userId: string } | Response> {
  const { data: userData, error: userError } = await caller.auth.getUser()
  if (userError || !userData.user) return json({ error: 'invalid_session' }, 401)
  const { data: allowed, error } = await caller.rpc('has_permission', {
    p_property_id: propertyId,
    p_permission_slug: permission,
  })
  if (error || allowed !== true) return json({ error: 'forbidden' }, 403)
  return { userId: userData.user.id }
}

// Edge Runtime keeps a function alive for work handed to waitUntil after
// the response is sent (needed to answer Microsoft's webhook in time).
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined

export function runInBackground(promise: Promise<unknown>): void {
  const guarded = promise.catch((error) => console.error('smart-inbox background task failed', error))
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(guarded)
}

import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type ResetBody = {
  membershipId?: unknown
  newPassword?: unknown
}

// Platform Admin's analogue of reset-team-member-password, for a property
// she holds no ordinary membership on (Fase C, PR C6). The authorization
// check and the audit entry both happen inside platform_reset_team_member_
// password -- called here as the CALLER's own client, so it runs under her
// real identity -- which also hands back the profile_id to update. Setting
// the password itself still needs the Admin API, hence the service-role
// step afterward, same two-step split as platform-create-team-member.
Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const authorization = request.headers.get('Authorization')
  if (!authorization) return json({ error: 'missing_authorization' }, 401)

  try {
    const body = await request.json() as ResetBody
    const membershipId = readUuid(body.membershipId)
    const newPassword = String(body.newPassword ?? '')

    if (!membershipId || newPassword.length < 8 || newPassword.length > 72) {
      return json({ error: 'invalid_input' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: 'server_not_configured' }, 500)

    const caller = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    })
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: userData, error: userError } = await caller.auth.getUser()
    if (userError || !userData.user) return json({ error: 'invalid_session' }, 401)

    const { data: profileId, error: authorizeError } = await caller.rpc('platform_reset_team_member_password', {
      p_membership_id: membershipId,
    })
    if (authorizeError || !profileId) {
      const message = (authorizeError as { message?: string } | null)?.message ?? ''
      if (/not_a_credentials_account/.test(message)) return json({ error: 'not_a_credentials_account' }, 400)
      if (/membership_not_found/.test(message)) return json({ error: 'membership_not_found' }, 404)
      return json({ error: 'forbidden' }, 403)
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(profileId, { password: newPassword })
    if (updateError) return json({ error: 'reset_failed' }, 400)

    return json({ ok: true }, 200)
  } catch (error) {
    console.error('platform-reset-team-member-password failed', error)
    return json({ error: 'unexpected_error' }, 500)
  }
})

function readUuid(value: unknown): string | null {
  const candidate = String(value ?? '').trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate) ? candidate : null
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

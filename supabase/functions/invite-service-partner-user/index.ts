import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type InviteBody = {
  servicePartnerId?: unknown
  fullName?: unknown
  email?: unknown
}

// Mirrors invite-team-member exactly (same caller/admin split, same
// invite-then-rollback shape), scoped to service_partner_users instead of
// profiles/memberships: a staff member with dining.manage invites a real
// person at a linked restaurant to log into apps/partner. No role/job
// title to assign (the partner side has no Core role model at all, see
// the service_partner_users migration) -- just a name, an email, and
// which service_partner they're joining.
Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const authorization = request.headers.get('Authorization')
  if (!authorization) return json({ error: 'missing_authorization' }, 401)

  try {
    const body = await request.json() as InviteBody
    const servicePartnerId = readUuid(body.servicePartnerId)
    const fullName = String(body.fullName ?? '').trim()
    const email = String(body.email ?? '').trim().toLowerCase()

    if (!servicePartnerId || fullName.length < 2 || fullName.length > 120 || !isEmail(email)) {
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

    const { data: canManage, error: permissionError } = await caller.rpc('has_permission_anywhere', {
      p_permission_slug: 'dining.manage',
    })
    if (permissionError || !canManage) return json({ error: 'forbidden' }, 403)

    const { data: partner, error: partnerError } = await caller
      .from('service_partners')
      .select('id')
      .eq('id', servicePartnerId)
      .maybeSingle()
    if (partnerError || !partner) return json({ error: 'partner_not_found' }, 404)

    // PARTNER_APP_URL is a secret set once apps/partner has a real domain --
    // left unset, the invite still works, it just lands on whatever "Site
    // URL" the Supabase project has configured (apps/web's, today).
    const partnerAppUrl = Deno.env.get('PARTNER_APP_URL')
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      ...(partnerAppUrl ? { redirectTo: `${partnerAppUrl}/reimposta-password` } : {}),
    })
    if (inviteError || !invited.user) {
      const duplicate = /already|registered|exists/i.test(inviteError?.message ?? '')
      return json({ error: duplicate ? 'account_already_exists' : 'invite_failed' }, duplicate ? 409 : 400)
    }

    const authUserId = invited.user.id

    const { data: partnerUser, error: partnerUserError } = await caller
      .from('service_partner_users')
      .insert({ auth_user_id: authUserId, service_partner_id: servicePartnerId, full_name: fullName })
      .select('id')
      .single()

    if (partnerUserError || !partnerUser) {
      await admin.auth.admin.deleteUser(authUserId)
      return json({ error: 'partner_user_creation_failed' }, 400)
    }

    return json({ partnerUserId: partnerUser.id }, 201)
  } catch (error) {
    console.error('invite-service-partner-user failed', error)
    return json({ error: 'unexpected_error' }, 500)
  }
})

function readUuid(value: unknown): string | null {
  const candidate = String(value ?? '').trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate) ? candidate : null
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

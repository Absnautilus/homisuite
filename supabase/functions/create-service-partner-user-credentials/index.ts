import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type CreateBody = {
  servicePartnerId?: unknown
  fullName?: unknown
  email?: unknown
  password?: unknown
}

// The credentials alternative to invite-service-partner-user -- same
// relationship create-team-member-credentials has to invite-team-member.
// No email is sent at all: staff types the partner's email and a password
// directly and hands it to them some other way (in person, by phone),
// which also means this path works with no SMTP configured at all, unlike
// the invite flow.
Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const authorization = request.headers.get('Authorization')
  if (!authorization) return json({ error: 'missing_authorization' }, 401)

  try {
    const body = await request.json() as CreateBody
    const servicePartnerId = readUuid(body.servicePartnerId)
    const fullName = String(body.fullName ?? '').trim()
    const email = String(body.email ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')

    if (
      !servicePartnerId || fullName.length < 2 || fullName.length > 120 ||
      !isEmail(email) || password.length < 8 || password.length > 72
    ) {
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

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: fullName },
    })
    if (createErr || !created.user) {
      const duplicate = /already|registered|exists/i.test(createErr?.message ?? '')
      return json({ error: duplicate ? 'account_already_exists' : 'create_failed' }, duplicate ? 409 : 400)
    }

    const authUserId = created.user.id

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
    console.error('create-service-partner-user-credentials failed', error)
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

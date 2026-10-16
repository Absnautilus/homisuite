import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type CreateBody = {
  propertyId?: unknown
  fullName?: unknown
  username?: unknown
  password?: unknown
  roleId?: unknown
  jobTitleId?: unknown
}

// Platform Admin's analogue of create-team-member-credentials, for a
// property she holds no ordinary membership on (Fase C, PR C5). Same
// username+password shape, no email -- the console never asks Admin Master
// to pick an invite-vs-credentials mode, it only ever needs the simplest
// path for standing up a first account on a property.
//
// The one structural difference from the tenant version: that function
// inserts memberships/property_staff_details through the CALLER's own
// client, relying on RLS (has_permission('core.staff.manage')) to allow it.
// Admin Master has no such membership, so both inserts happen inside
// platform_insert_team_membership -- a single SECURITY DEFINER RPC that
// re-checks platform_operational_action_allowed itself and performs both
// inserts atomically in one transaction (see that migration's own comment
// for why no RLS policy on memberships/property_staff_details needed to
// change for this).
Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const authorization = request.headers.get('Authorization')
  if (!authorization) return json({ error: 'missing_authorization' }, 401)

  try {
    const body = await request.json() as CreateBody
    const propertyId = readUuid(body.propertyId)
    const roleId = readUuid(body.roleId)
    const jobTitleId = body.jobTitleId == null || body.jobTitleId === '' ? null : readUuid(body.jobTitleId)
    const fullName = String(body.fullName ?? '').trim()
    const username = String(body.username ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')

    if (
      !propertyId || !roleId || (body.jobTitleId && !jobTitleId) ||
      fullName.length < 2 || fullName.length > 120 ||
      !isUsername(username) || password.length < 8 || password.length > 72
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

    const { data: canManage, error: permissionError } = await caller.rpc('platform_operational_action_allowed', {
      p_property_id: propertyId,
      p_permission_slug: 'platform.team.manage',
    })
    if (permissionError || !canManage) return json({ error: 'forbidden' }, 403)

    const { data: property, error: propertyError } = await admin
      .from('properties')
      .select('slug, organizations(slug)')
      .eq('id', propertyId)
      .single()
    if (propertyError || !property) return json({ error: 'invalid_property' }, 400)
    const organizationSlug = (property.organizations as { slug: string } | null)?.slug
    if (!organizationSlug) return json({ error: 'invalid_property' }, 400)

    // Best-effort pre-check for a friendlier error than the partial unique
    // index's 23505 -- the index is still the source of truth, this just
    // avoids creating an orphan auth user first.
    const { data: existingUsername } = await admin
      .from('memberships')
      .select('id')
      .eq('property_id', propertyId)
      .eq('username', username)
      .maybeSingle()
    if (existingUsername) return json({ error: 'username_already_exists' }, 409)

    const loginIdentifier = `${username}@${property.slug}.${organizationSlug}.platform-admin.hotsflow.internal`

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: loginIdentifier,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })
    if (createError || !created.user) {
      const duplicate = /already|registered|exists/i.test(createError?.message ?? '')
      return json({ error: duplicate ? 'account_already_exists' : 'create_failed' }, duplicate ? 409 : 400)
    }

    const profileId = created.user.id
    const { error: profileError } = await admin.from('profiles').insert({ id: profileId, full_name: fullName })
    if (profileError) {
      await admin.auth.admin.deleteUser(profileId)
      return json({ error: 'profile_creation_failed' }, 400)
    }

    const { data: membershipId, error: membershipError } = await caller.rpc('platform_insert_team_membership', {
      p_property_id: propertyId,
      p_profile_id: profileId,
      p_role_id: roleId,
      p_username: username,
      p_job_title_id: jobTitleId,
    })
    if (membershipError || !membershipId) {
      await admin.auth.admin.deleteUser(profileId)
      const message = (membershipError as { message?: string } | null)?.message ?? ''
      const duplicate = /duplicate|unique/i.test(message)
      if (/invalid_role/.test(message)) return json({ error: 'invalid_role' }, 400)
      if (/invalid_job_title/.test(message)) return json({ error: 'invalid_job_title' }, 400)
      return json({ error: duplicate ? 'username_already_exists' : 'membership_creation_failed' }, duplicate ? 409 : 400)
    }

    return json({ profileId, membershipId, loginIdentifier }, 201)
  } catch (error) {
    console.error('platform-create-team-member failed', error)
    return json({ error: 'unexpected_error' }, 500)
  }
})

function readUuid(value: unknown): string | null {
  const candidate = String(value ?? '').trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate) ? candidate : null
}

// Mirrors memberships_username_format's check constraint exactly.
function isUsername(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{1,30}[a-z0-9]$/.test(value)
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

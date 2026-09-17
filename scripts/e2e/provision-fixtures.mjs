#!/usr/bin/env node
// Deterministic browser-test fixtures for the LOCAL Supabase stack only.
// The CI job obtains the URL and service-role key from `supabase status`
// after `supabase start`; no hosted-project secret is used here.

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY from the local Supabase stack.')
  process.exit(1)
}

export const E2E_PASSWORD = 'e2e-smoke-test-password-only'
export const E2E_ORG_ADMIN_EMAIL = 'e2e-org-admin@example.test'
export const E2E_RECEPTIONIST_EMAIL = 'e2e-receptionist@example.test'

const ORGANIZATION_A_ID = 'a0000000-0000-0000-0000-000000000001'
const PROPERTY_A1_ID = 'a1000000-0000-0000-0000-000000000001'
const ORG_ADMIN_MEMBERSHIP_ID = 'e1000000-0000-0000-0000-000000000001'
const RECEPTIONIST_MEMBERSHIP_ID = 'e1000000-0000-0000-0000-000000000002'
const RECEPTIONIST_JOB_TITLE_ID = 'e1100000-0000-0000-0000-000000000001'
const HOTEL_ID = 'e2000000-0000-0000-0000-000000000001'
const ROOM_ID = 'e2100000-0000-0000-0000-000000000001'
const STAY_ID = 'e2200000-0000-0000-0000-000000000001'

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function ensureUser(email, fullName) {
  const { data: users, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listError) throw listError

  let user = users.users.find((candidate) => candidate.email === email)
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: E2E_PASSWORD,
      email_confirm: true,
    })
    if (error) throw error
    user = data.user
  }

  const { error: profileError } = await admin
    .from('profiles')
    .upsert({ id: user.id, full_name: fullName }, { onConflict: 'id' })
  if (profileError) throw profileError

  return user.id
}

async function roleId(slug) {
  const { data, error } = await admin.from('roles').select('id').eq('slug', slug).single()
  if (error) throw error
  return data.id
}

async function main() {
  const [orgAdminId, receptionistId, organizationAdminRoleId, receptionistRoleId] = await Promise.all([
    ensureUser(E2E_ORG_ADMIN_EMAIL, 'E2E Org Admin'),
    ensureUser(E2E_RECEPTIONIST_EMAIL, 'E2E Receptionist'),
    roleId('organization_admin'),
    roleId('receptionist'),
  ])

  const { error: orgMembershipError } = await admin.from('memberships').upsert(
    {
      id: ORG_ADMIN_MEMBERSHIP_ID,
      profile_id: orgAdminId,
      organization_id: ORGANIZATION_A_ID,
      role_id: organizationAdminRoleId,
      status: 'active',
    },
    { onConflict: 'id' },
  )
  if (orgMembershipError) throw orgMembershipError

  const { error: propertyMembershipError } = await admin.from('memberships').upsert(
    {
      id: RECEPTIONIST_MEMBERSHIP_ID,
      profile_id: receptionistId,
      property_id: PROPERTY_A1_ID,
      role_id: receptionistRoleId,
      status: 'active',
    },
    { onConflict: 'id' },
  )
  if (propertyMembershipError) throw propertyMembershipError

  const { error: jobTitleError } = await admin.from('property_job_titles').upsert(
    {
      id: RECEPTIONIST_JOB_TITLE_ID,
      property_id: PROPERTY_A1_ID,
      name: 'E2E Reception',
      active: true,
      sees_full_queue: true,
    },
    { onConflict: 'id' },
  )
  if (jobTitleError) throw jobTitleError

  const { error: staffDetailsError } = await admin.from('property_staff_details').upsert(
    {
      property_id: PROPERTY_A1_ID,
      profile_id: receptionistId,
      job_title_id: RECEPTIONIST_JOB_TITLE_ID,
      employment_status: 'active',
    },
    { onConflict: 'property_id,profile_id' },
  )
  if (staffDetailsError) throw staffDetailsError

  const { error: hotelError } = await admin
    .from('hotels')
    .upsert({ id: HOTEL_ID, name: 'E2E Hotel', active: true }, { onConflict: 'id' })
  if (hotelError) throw hotelError

  const { error: mappingError } = await admin.from('legacy_property_mapping').upsert(
    { legacy_hotel_id: HOTEL_ID, platform_property_id: PROPERTY_A1_ID },
    { onConflict: 'legacy_hotel_id' },
  )
  if (mappingError) throw mappingError

  const { error: adminStaffError } = await admin.from('staff_profiles').upsert(
    { hotel_id: HOTEL_ID, auth_user_id: orgAdminId, name: 'E2E Org Admin', role: 'admin', department: null, active: true },
    { onConflict: 'auth_user_id' },
  )
  if (adminStaffError) throw adminStaffError

  const { error: receptionistStaffError } = await admin.from('staff_profiles').upsert(
    {
      hotel_id: HOTEL_ID,
      auth_user_id: receptionistId,
      name: 'E2E Receptionist',
      role: 'operatore',
      department: 'reception',
      login_username: 'e2e-receptionist',
      active: true,
    },
    { onConflict: 'auth_user_id' },
  )
  if (receptionistStaffError) throw receptionistStaffError

  const { error: roomError } = await admin
    .from('rooms')
    .upsert({ id: ROOM_ID, hotel_id: HOTEL_ID, room_number: '101', active: true }, { onConflict: 'id' })
  if (roomError) throw roomError

  const checkIn = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const checkOut = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const { error: stayError } = await admin.from('stays').upsert(
    {
      id: STAY_ID,
      hotel_id: HOTEL_ID,
      room_id: ROOM_ID,
      guest_last_name: 'Rossi',
      guest_pin: '1234',
      check_in_at: checkIn,
      check_out_at: checkOut,
      status: 'active',
      source: 'manual',
    },
    { onConflict: 'id' },
  )
  if (stayError) throw stayError

  console.log('Local E2E fixtures ready: 2 users, 2 memberships, 1 job title, 1 mapped hotel, 1 active stay.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

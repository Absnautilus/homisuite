import { createClient } from 'npm:@supabase/supabase-js@2.116.0'
import webpush from 'npm:web-push@3.6.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type GuestRequestRecord = {
  id?: unknown
  hotel_id?: unknown
  room_number?: unknown
  assigned_job_title_ids?: unknown
}

type Body = {
  type?: unknown
  record?: unknown
  target_staff_id?: unknown
}

const EVENT_TYPES = new Set(['urgent_flagged', 'priority_changed', 'unclaimed', 'stalled', 'reminder'])

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const vapidSubject = Deno.env.get('VAPID_SUBJECT')
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!vapidSubject || !vapidPublicKey || !vapidPrivateKey || !supabaseUrl || !serviceRoleKey) {
      return json({ error: 'server_not_configured' }, 500)
    }

    const body = (await request.json()) as Body
    const eventType = typeof body.type === 'string' && EVENT_TYPES.has(body.type) ? body.type : null
    const record = body.record as GuestRequestRecord | undefined
    const requestId = readUuid(record?.id)
    const hotelId = readUuid(record?.hotel_id)
    const roomNumber = typeof record?.room_number === 'string' ? record.room_number : null
    const assignedJobTitleIds = readUuidArray(record?.assigned_job_title_ids)
    if (!eventType || !requestId || !hotelId || !roomNumber) return json({ error: 'invalid_payload' }, 400)

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })

    let profileIds: string[]
    if (eventType === 'reminder') {
      // Targeted at whoever currently has the request in charge, regardless
      // of on_duty -- unlike the broadcast types below, this is a nudge to
      // one already-identified person, not a page to whoever's working.
      const targetStaffId = readUuid(body.target_staff_id)
      if (!targetStaffId) return json({ error: 'invalid_payload' }, 400)
      const { data: staff, error: staffError } = await admin
        .from('staff_profiles')
        .select('auth_user_id')
        .eq('id', targetStaffId)
        .maybeSingle()
      if (staffError) {
        console.error('notify-request-event: target staff lookup failed', staffError)
        return json({ error: 'recipient_lookup_failed' }, 500)
      }
      profileIds = staff?.auth_user_id ? [staff.auth_user_id as string] : []
    } else {
      // urgent_flagged / priority_changed / unclaimed / stalled all broadcast
      // to whoever is on duty for this hotel/request, via the same
      // on_duty-gated recipient rule already used for the existing types.
      const { data: recipients, error: recipientError } = await admin.rpc('housekeeping_push_recipient_profiles', {
        p_hotel_id: hotelId,
        p_assigned_job_title_ids: assignedJobTitleIds,
        p_exclude_staff_id: null,
      })
      if (recipientError) {
        console.error('notify-request-event: recipient lookup failed', recipientError)
        return json({ error: 'recipient_lookup_failed' }, 500)
      }
      profileIds = [...new Set((recipients ?? []).map((row: { profile_id: string }) => row.profile_id))]
    }
    if (profileIds.length === 0) return json({ ok: true, sent: 0, reason: 'no_recipients' }, 200)

    const { data: subscriptions, error: subscriptionsError } = await admin
      .from('device_push_subscriptions')
      .select('endpoint, p256dh, auth')
      .in('profile_id', profileIds)
    if (subscriptionsError) {
      console.error('notify-request-event: subscription lookup failed', subscriptionsError)
      return json({ error: 'subscription_lookup_failed' }, 500)
    }

    const title =
      eventType === 'urgent_flagged' ? 'Richiesta urgente'
      : eventType === 'priority_changed' ? 'Priorità aggiornata'
      : eventType === 'unclaimed' ? 'Richiesta in attesa'
      : eventType === 'stalled' ? 'Richiesta da completare'
      : 'Promemoria'
    const notificationBody = eventType === 'reminder' ? `Camera ${roomNumber}: completa la richiesta` : `Camera ${roomNumber}`
    const payload = JSON.stringify({
      title,
      body: notificationBody,
      data: { requestId, type: eventType, url: '/housekeeping' },
    })

    let sent = 0
    await Promise.all(
      (subscriptions ?? []).map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint as string,
              keys: {
                p256dh: subscription.p256dh as string,
                auth: subscription.auth as string,
              },
            },
            payload,
          )
          sent++
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode
          if (statusCode === 404 || statusCode === 410) {
            await admin.from('device_push_subscriptions').delete().eq('endpoint', subscription.endpoint as string)
          } else {
            console.error('notify-request-event: push failed', statusCode, error)
          }
        }
      }),
    )

    return json({ ok: true, sent, recipients: profileIds.length, subscriptions: subscriptions?.length ?? 0 }, 200)
  } catch (error) {
    console.error('notify-request-event failed', error)
    return json({ error: 'unexpected_error' }, 500)
  }
})

function readUuid(value: unknown): string | null {
  const candidate = String(value ?? '').trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate) ? candidate : null
}

function readUuidArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(readUuid).filter((item): item is string => item !== null)
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

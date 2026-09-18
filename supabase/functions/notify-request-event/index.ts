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
}

type Body = {
  type?: unknown
  record?: unknown
}

// Called by two guest_requests triggers (20260918150000): a manual
// priority reorder, and a request being flagged urgent. Deliberately does
// NOT replicate the mansione-based visibility guest_requests' own RLS uses
// (request_category_job_titles/sees_full_queue, 20260917120000) to decide
// who gets pinged -- that model is about routing a request to the right
// job titles, changes independently of this function, and under-notifying
// (a silently dropped ping because of a job-title mismatch) is a worse
// failure here than over-notifying. Every on-duty, active staff member at
// the hotel gets pinged, same breadth notify-new-request already uses for
// brand-new requests.
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
    const eventType = body.type === 'urgent_flagged' ? 'urgent_flagged' : body.type === 'priority_changed' ? 'priority_changed' : null
    const record = body.record as GuestRequestRecord | undefined
    const requestId = readUuid(record?.id)
    const hotelId = readUuid(record?.hotel_id)
    const roomNumber = typeof record?.room_number === 'string' ? record.room_number : null
    if (!eventType || !requestId || !hotelId || !roomNumber) return json({ error: 'invalid_payload' }, 400)

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })

    const { data: staff, error: staffError } = await admin
      .from('staff_profiles')
      .select('id')
      .eq('hotel_id', hotelId)
      .eq('active', true)
      .eq('on_duty', true)
    if (staffError) return json({ error: 'lookup_failed' }, 500)
    const staffIds = (staff ?? []).map((s) => s.id as string)
    if (staffIds.length === 0) return json({ ok: true, sent: 0 }, 200)

    const { data: subscriptions, error: subsError } = await admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .in('staff_id', staffIds)
    if (subsError) return json({ error: 'lookup_failed' }, 500)

    const title = eventType === 'urgent_flagged' ? 'Richiesta urgente' : 'Priorità aggiornata'
    const messageBody = `Camera ${roomNumber}`
    const payload = JSON.stringify({ title, body: messageBody, data: { requestId, type: eventType } })

    let sent = 0
    await Promise.all(
      (subscriptions ?? []).map(async (sub) => {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint as string, keys: { p256dh: sub.p256dh as string, auth: sub.auth as string } }, payload)
          sent++
        } catch (error) {
          // 404/410 means the browser dropped the subscription (cleared
          // site data, uninstalled) -- delete it so future events stop
          // retrying a dead endpoint forever.
          const statusCode = (error as { statusCode?: number }).statusCode
          if (statusCode === 404 || statusCode === 410) {
            await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint as string)
          } else {
            console.error('notify-request-event: push failed', statusCode, error)
          }
        }
      }),
    )

    return json({ ok: true, sent }, 200)
  } catch (error) {
    console.error('notify-request-event failed', error)
    return json({ error: 'unexpected_error' }, 500)
  }
})

function readUuid(value: unknown): string | null {
  const candidate = String(value ?? '').trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate) ? candidate : null
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

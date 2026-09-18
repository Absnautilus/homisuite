// Web Push service worker: shows the notification and handles the
// "Accetta richiesta" / "Rifiuta richiesta" actions, or a tap on the
// notification body, by opening (or focusing) the Housekeeping module with
// ?claim=<id> or ?reject=<id>, which staff-app.tsx reads to auto-claim or
// auto-reject the request. /housekeeping, not /staff -- the embedded module
// mounts at that path in this shell (HousekeepingModuleGate's basePath),
// unlike the original standalone Housekeeping app's own /staff route.
//
// data.data.type distinguishes what triggered the push (added for
// notify-request-event: 'priority_changed' / 'urgent_flagged', alongside
// notify-new-request's own pings) -- defaults to 'new_request' when absent
// so every payload sent before this type existed keeps behaving exactly as
// before. Only a brand-new, unclaimed request makes sense to accept/reject
// straight from the notification; the other event types are informational
// and just open the queue on tap.
self.addEventListener('push', (event) => {
  let data = { title: 'Homisuite', body: 'Nuova richiesta', data: {} }
  try {
    if (event.data) data = { ...data, ...event.data.json() }
  } catch {
    // ignore malformed payloads, fall back to the defaults above
  }

  const isNewRequest = (data.data?.type ?? 'new_request') === 'new_request'

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/favicon-48x48.png',
      data: data.data,
      actions: isNewRequest
        ? [
            { action: 'accept', title: 'Accetta richiesta' },
            { action: 'reject', title: 'Rifiuta richiesta' },
          ]
        : [],
      requireInteraction: isNewRequest,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const requestId = event.notification.data?.requestId
  const url =
    event.action === 'reject' && requestId
      ? `/housekeeping?reject=${requestId}`
      : event.action === 'accept' && requestId
        ? `/housekeeping?claim=${requestId}`
        : (event.notification.data?.url ?? '/housekeeping')

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of clientsList) {
        if ('focus' in client) {
          await client.focus()
          if ('navigate' in client) await client.navigate(url)
          return
        }
      }
      await self.clients.openWindow(url)
    })(),
  )
})

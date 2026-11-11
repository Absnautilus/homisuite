// Web Push service worker: shows Homisuite notifications and handles the
// "Ignora" / "Accetta" actions for brand-new requests.
//
// Visual layout is controlled by the browser/OS; we can reliably control
// title, body, icon, badge and action labels. New-request notifications stay
// on screen (requireInteraction) until the person acts on them -- Accetta,
// Ignora, or the OS's own dismiss -- instead of vanishing on their own after
// a few seconds, which meant a request could go unnoticed if nobody happened
// to be looking right then.
//
// All navigation stays inside Homisuite. Accepting opens the embedded
// Housekeeping module with ?claim=<id>; ignoring only closes the native
// notification and never changes the request status.

// Without this, a new deploy's service worker sits "waiting" until every tab
// a client controls is closed -- fine for a desktop browser tab someone
// actually closes, but an Android app installed to the home screen is almost
// never fully closed (backgrounding it doesn't count), so it can be stuck
// running whatever version of this file was installed, indefinitely, even
// though a newer one (with this very fix, or any future push-handling fix)
// has already been deployed. skipWaiting + clients.claim make a newly
// installed worker take over immediately instead of waiting for that.
self.addEventListener('install', () => {
  self.skipWaiting()
})
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = { title: 'Homisuite', body: 'Nuova richiesta', data: {} }
  try {
    if (event.data) data = { ...data, ...event.data.json() }
  } catch {
    // Ignore malformed payloads and use the defaults above.
  }

  const isNewRequest = (data.data?.type ?? 'new_request') === 'new_request'
  const requestId = data.data?.requestId
  const tag = requestId ? `housekeeping-request-${requestId}` : undefined
  const actionableNewRequest = isNewRequest && Boolean(requestId)

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/favicon-48x48.png',
      data: data.data,
      tag,
      actions: actionableNewRequest
        ? [
            { action: 'ignore', title: 'Ignora' },
            { action: 'accept', title: 'Accetta' },
          ]
        : [],
      requireInteraction: actionableNewRequest,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  if (event.action === 'ignore') return

  const requestId = event.notification.data?.requestId
  const url =
    event.action === 'accept' && requestId
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

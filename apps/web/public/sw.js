// Web Push service worker: shows Homisuite notifications and handles the
// "Ignora" / "Accetta" actions for brand-new requests.
//
// Visual layout is controlled by the browser/OS; we can reliably control
// title, body, icon, badge and action labels. New-request notifications are
// intentionally non-persistent and are closed after roughly three seconds
// on platforms that keep the service worker alive for the push event.
//
// All navigation stays inside Homisuite. Accepting opens the embedded
// Housekeeping module with ?claim=<id>; ignoring only closes the native
// notification and never changes the request status.

const NEW_REQUEST_AUTO_CLOSE_MS = 3_000

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

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(data.title, {
        body: data.body,
        icon: '/icon-192.png',
        badge: '/favicon-48x48.png',
        data: data.data,
        tag,
        actions: isNewRequest
          ? [
              { action: 'ignore', title: 'Ignora' },
              { action: 'accept', title: 'Accetta' },
            ]
          : [],
        requireInteraction: false,
      })

      if (!isNewRequest) return

      await new Promise((resolve) => setTimeout(resolve, NEW_REQUEST_AUTO_CLOSE_MS))
      const notifications = tag
        ? await self.registration.getNotifications({ tag })
        : await self.registration.getNotifications()

      for (const notification of notifications) {
        if (!tag || notification.tag === tag) notification.close()
      }
    })(),
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

self.addEventListener('push', (event) => {
  let data = { title: 'Homisuite', body: 'Nuova richiesta', data: {} }
  try {
    if (event.data) data = { ...data, ...event.data.json() }
  } catch {
    // Ignore malformed payloads and fall back to defaults.
  }

  const isNewRequest = (data.data?.type ?? 'new_request') === 'new_request'

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const visibleWindows = windows.filter((client) => client.visibilityState === 'visible')

    // When Homisuite is already visible, use the in-app toast instead of
    // showing a second OS notification for the same event.
    if (visibleWindows.length > 0) {
      for (const client of visibleWindows) {
        client.postMessage({
          type: 'homisuite-push',
          notification: {
            title: data.title,
            body: data.body,
            data: data.data,
            actions: isNewRequest ? ['ignore', 'accept'] : [],
          },
        })
      }
      return
    }

    await self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/favicon-48x48.png',
      data: data.data,
      tag: data.data?.requestId ? `guest-request-${data.data.requestId}` : undefined,
      actions: isNewRequest
        ? [
            { action: 'ignore', title: 'Ignora' },
            { action: 'accept', title: 'Accetta' },
          ]
        : [],
      requireInteraction: false,
    })
  })())
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

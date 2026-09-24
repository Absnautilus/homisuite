// Pure VAPID-key helpers, split out from devicePush.ts so they're testable
// under plain Node (that file reads import.meta.env at module scope, which
// only Vite provides -- importing it directly crashes under `node --test`).

export function urlBase64ToUint8Array(base64url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4)
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

// A Web Push subscription is permanently bound to the VAPID key it was
// created with -- the push service (FCM, etc.) rejects every future send
// with a "credentials do not correspond" error if the server later signs
// with a different key, e.g. after a VAPID key rotation. Returns true when
// we can't tell (some engines don't expose applicationServerKey), since a
// false positive here would force-unsubscribe a perfectly good device.
export function subscriptionKeyMatches(existingKey: ArrayBuffer | null, currentKey: Uint8Array): boolean {
  if (!existingKey) return true
  const existingBytes = new Uint8Array(existingKey)
  return existingBytes.length === currentKey.length && existingBytes.every((byte, i) => byte === currentKey[i])
}

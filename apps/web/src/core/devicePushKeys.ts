export function urlBase64ToUint8Array(base64url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4)
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export function subscriptionKeyMatches(existingKey: ArrayBuffer | null, currentKey: Uint8Array): boolean | null {
  if (!existingKey) return null
  const existingBytes = new Uint8Array(existingKey)
  return existingBytes.length === currentKey.length && existingBytes.every((byte, i) => byte === currentKey[i])
}

export async function vapidKeyFingerprint(vapidPublicKey: string): Promise<string> {
  const bytes = new TextEncoder().encode(vapidPublicKey.trim())
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

import { subscriptionKeyMatches, urlBase64ToUint8Array, vapidKeyFingerprint } from './devicePushKeys'

const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? null

export const DEVICE_PUSH_SUPPORTED =
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && VAPID_PUBLIC_KEY !== null

export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!DEVICE_PUSH_SUPPORTED) return null
  const registration = await navigator.serviceWorker.getRegistration('/sw.js')
  if (!registration) return null
  return registration.pushManager.getSubscription()
}

export async function getCurrentVapidFingerprint(): Promise<string> {
  if (!VAPID_PUBLIC_KEY) throw new Error('push_not_configured')
  return vapidKeyFingerprint(VAPID_PUBLIC_KEY)
}

export async function ensureCurrentPushSubscription({
  requestPermission = false,
  forceResubscribe = false,
}: {
  requestPermission?: boolean
  forceResubscribe?: boolean
} = {}): Promise<PushSubscription | null> {
  if (!DEVICE_PUSH_SUPPORTED) return null

  if (requestPermission) {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') throw new Error('permission_denied')
  } else if (Notification.permission !== 'granted') {
    return null
  }

  const registration = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready

  const currentKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY as string)
  const existing = await registration.pushManager.getSubscription()
  if (existing) {
    const matches = subscriptionKeyMatches(existing.options.applicationServerKey, currentKey)
    if (!forceResubscribe && matches !== false) return existing

    const removed = await existing.unsubscribe()
    if (!removed) {
      const stillExisting = await registration.pushManager.getSubscription()
      if (stillExisting) throw new Error('push_unsubscribe_failed')
    }
  }

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: currentKey as BufferSource,
  })
}

export async function subscribeDevicePush(): Promise<PushSubscription> {
  const subscription = await ensureCurrentPushSubscription({ requestPermission: true })
  if (!subscription) throw new Error('push_unavailable')
  return subscription
}

export function toSubscriptionKeys(
  subscription: PushSubscription,
  vapidKeyFingerprintValue: string,
): { endpoint: string; p256dh: string; auth: string; vapidKeyFingerprint: string } {
  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error('invalid_subscription')
  return {
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    vapidKeyFingerprint: vapidKeyFingerprintValue,
  }
}

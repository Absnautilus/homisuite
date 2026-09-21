import { VAPID_PUBLIC_KEY } from '@/lib/env'
import { savePushSubscription, setOnDuty } from '@/lib/staff-api'

export const PUSH_SUPPORTED =
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && VAPID_PUBLIC_KEY !== null

function urlBase64ToUint8Array(base64url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4)
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

async function ensurePushSubscription(): Promise<void> {
  const registration = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready

  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY as string) as BufferSource,
    })
  }

  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error('invalid_subscription')
  await savePushSubscription({ endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth })
}

// "In servizio" is the explicit user gesture that enables Housekeeping
// notifications on this device. The subscription is stored in the Core
// device_push_subscriptions registry, shared with the shell's notification
// preference, while on_duty remains the operational gate used by the sender.
export async function goOnDuty(): Promise<void> {
  if (!PUSH_SUPPORTED) {
    await setOnDuty(true)
    return
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('permission_denied')

  await ensurePushSubscription()
  await setOnDuty(true)
}

// Going off duty deliberately keeps the device subscription. It may be used
// by other Homisuite modules, while Housekeeping itself stops sending because
// its recipient query requires on_duty=true.
export async function goOffDuty(): Promise<void> {
  await setOnDuty(false)
}

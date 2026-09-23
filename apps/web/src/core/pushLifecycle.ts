import { core } from './client'
import {
  DEVICE_PUSH_SUPPORTED,
  ensureCurrentPushSubscription,
  getCurrentVapidFingerprint,
  getExistingPushSubscription,
  toSubscriptionKeys,
} from './devicePush'

const PUSH_ENABLED_KEY = 'homisuite.push.enabled'

export function getLocalPushPreference(): boolean | null {
  if (typeof window === 'undefined') return null
  const value = window.localStorage.getItem(PUSH_ENABLED_KEY)
  if (value === '1') return true
  if (value === '0') return false
  return null
}

export function setLocalPushPreference(enabled: boolean): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(PUSH_ENABLED_KEY, enabled ? '1' : '0')
}

export async function repairAndClaimCurrentPushSubscription(): Promise<void> {
  if (!DEVICE_PUSH_SUPPORTED || Notification.permission !== 'granted') return

  const existing = await getExistingPushSubscription()
  if (!existing) return

  const localPreference = getLocalPushPreference()
  if (localPreference === false) return

  const registered = await core.getDevicePushSubscription(existing.endpoint)
  // On legacy installs there is no local preference yet. Only auto-enable
  // when this signed-in profile already owns the browser endpoint. A shared
  // device is auto-claimed by the next user only after the device has an
  // explicit enabled marker from Homisuite.
  if (localPreference !== true && !registered) return

  const currentFingerprint = await getCurrentVapidFingerprint()
  const forceResubscribe = registered?.vapidKeyFingerprint !== currentFingerprint
  const current = await ensureCurrentPushSubscription({ forceResubscribe })
  if (!current) return

  if (registered && current.endpoint !== existing.endpoint) {
    await core.deleteDevicePushSubscription(existing.endpoint).catch(() => undefined)
  }

  await core.saveDevicePushSubscription(toSubscriptionKeys(current, currentFingerprint))
  setLocalPushPreference(true)
}

export async function releaseCurrentPushSubscription(): Promise<void> {
  if (!DEVICE_PUSH_SUPPORTED) return
  const existing = await getExistingPushSubscription()
  if (!existing) return
  await core.deleteDevicePushSubscription(existing.endpoint).catch(() => undefined)
}

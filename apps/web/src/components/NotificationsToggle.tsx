import { useEffect, useState } from 'react'
import { Switch } from './Switch'
import { core } from '../core/client'
import { DEVICE_PUSH_SUPPORTED, getExistingPushSubscription, subscribeDevicePush, toSubscriptionKeys } from '../core/devicePush'

const BLOCKED_MESSAGE = 'Notifiche bloccate dal browser per questo sito. Sbloccale dalle impostazioni del sito (icona del lucchetto nella barra degli indirizzi) per attivarle.'

export function NotificationsToggle() {
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Checked once up front so a browser-level block shows immediately --
  // without this, the row looks like an ordinary off toggle until the
  // person clicks it and only then learns it's blocked.
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    if (!DEVICE_PUSH_SUPPORTED) {
      setSubscribed(false)
      return
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
      setBlocked(true)
      setSubscribed(false)
      return
    }
    let cancelled = false
    getExistingPushSubscription()
      .then((subscription) => (subscription ? core.isDevicePushSubscribed(subscription.endpoint) : false))
      .then((value) => {
        if (!cancelled) setSubscribed(value)
      })
      .catch(() => {
        if (!cancelled) setSubscribed(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function turnOff() {
    // Only the device_push_subscriptions row is removed -- the browser
    // subscription itself is left alone. It may be shared with
    // Housekeeping's own on-duty push flow, which never tears it down
    // either (see modules/housekeeping/src/lib/push.ts); unsubscribing at
    // the browser level here would silently break that unrelated feature.
    const previous = subscribed
    setSubscribed(false)
    try {
      const subscription = await getExistingPushSubscription()
      if (subscription) await core.deleteDevicePushSubscription(subscription.endpoint)
    } catch {
      setSubscribed(previous)
      setError('Non è stato possibile disattivare le notifiche.')
    }
  }

  async function turnOn() {
    setError(null)
    try {
      const subscription = await subscribeDevicePush()
      await core.saveDevicePushSubscription(toSubscriptionKeys(subscription))
      setSubscribed(true)
    } catch (cause) {
      setSubscribed(false)
      if (cause instanceof Error && cause.message === 'permission_denied') {
        setBlocked(true)
      } else {
        setError('Non è stato possibile attivare le notifiche.')
      }
    }
  }

  if (!DEVICE_PUSH_SUPPORTED) {
    return <span className="settings-row-status">Non disponibile su questo dispositivo</span>
  }

  return (
    <span className="settings-row-control-inline">
      <Switch
        checked={Boolean(subscribed)}
        onChange={() => void (subscribed ? turnOff() : turnOn())}
        disabled={subscribed === null || blocked}
        aria-label="Notifiche push su questo dispositivo"
      />
      {blocked ? (
        <small className="form-error" role="alert">{BLOCKED_MESSAGE}</small>
      ) : (
        error && <small className="form-error" role="alert">{error}</small>
      )}
    </span>
  )
}

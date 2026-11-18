import { useCallback, useRef, useState } from 'react'

export interface ToastCard {
  title: string
  onAccept: () => void
  // Returns whether the reject actually went through -- a caller that
  // confirms first (so a quick tap on the toast can't silently reject
  // something, the same way the request list's own reject already
  // confirms) returns false on cancel, and the card stays open instead
  // of disappearing as if it had been handled.
  onReject?: () => boolean | Promise<boolean>
}

export interface Toast {
  id: string
  tone: 'info' | 'warning' | 'success' | 'error'
  message?: string
  card?: ToastCard
}

let counter = 0

export function useToasts(autoDismissMs = 8000) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (message: string, tone: Toast['tone'] = 'info') => {
      const id = `t${++counter}`
      setToasts((prev) => [...prev, { id, message, tone }])
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), autoDismissMs),
      )
    },
    [autoDismissMs, dismiss],
  )

  // A new pending request stays actionable right from the toast (accept /
  // reject inline) instead of just announcing it — no auto-dismiss timer,
  // since accepting/rejecting is itself what should close it.
  const pushCard = useCallback((card: ToastCard) => {
    const id = `t${++counter}`
    setToasts((prev) => [...prev, { id, tone: 'info', card }])
    return id
  }, [])

  return { toasts, push, pushCard, dismiss }
}

import { createContext, useContext, type ReactNode } from 'react'
import { useToasts } from '@/hooks/use-toasts'
import { ToastStack } from '@/components/toast-stack'

type ToastApi = ReturnType<typeof useToasts>

const ToastContext = createContext<ToastApi | null>(null)

// One shared stack for the whole staff app (mounted once in StaffApp) so
// every page's save/toggle/delete feedback lands in the same bottom-right
// corner, instead of each page owning its own useToasts()+ToastStack pair
// that would only cover that one page's own subtree.
export function ToastProvider({ children }: { children: ReactNode }) {
  const toastApi = useToasts()
  return (
    <ToastContext.Provider value={toastApi}>
      {children}
      <ToastStack toasts={toastApi.toasts} onDismiss={toastApi.dismiss} />
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}

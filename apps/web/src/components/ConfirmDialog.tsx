import { useState, type ReactNode } from 'react'
import { Button, Modal } from '@homisuite/ui'

export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void
}

// Renders nothing until something calls the `confirm` function it returns --
// that function resolves to true/false once the person picks a button, so a
// destructive action can just `if (!(await confirm({...}))) return`.
export function useConfirm(): [ReactNode, (options: ConfirmOptions) => Promise<boolean>] {
  const [pending, setPending] = useState<PendingConfirm | null>(null)

  function confirm(options: ConfirmOptions) {
    return new Promise<boolean>((resolve) => setPending({ ...options, resolve }))
  }

  function settle(value: boolean) {
    pending?.resolve(value)
    setPending(null)
  }

  const dialog = (
    <Modal
      open={Boolean(pending)}
      title={pending?.title ?? ''}
      description={pending?.description}
      onClose={() => settle(false)}
      footer={
        <>
          <Button variant="secondary" onClick={() => settle(false)}>
            Annulla
          </Button>
          <Button variant="danger" onClick={() => settle(true)}>
            {pending?.confirmLabel ?? 'Elimina'}
          </Button>
        </>
      }
    />
  )

  return [dialog, confirm]
}

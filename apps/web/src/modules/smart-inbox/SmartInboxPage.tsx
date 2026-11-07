import { useEffect, useState } from 'react'
import { ModuleNav } from '@homisuite/ui'
import { BookOpenText, Inbox, Settings } from 'lucide-react'
import { PageState } from '../../components/PageState'
import { supabase } from '../../core/client'
import { useModuleRuntime } from '../../core/ModuleRuntimeContext'
import { InboxTab } from './InboxTab'
import { KnowledgeTab } from './KnowledgeTab'
import { SettingsTab } from './SettingsTab'
import type { InboxView } from './labels'
import './smart-inbox.css'

const TABS = [
  { value: 'posta', label: 'Posta', icon: <Inbox /> },
  { value: 'informazioni', label: 'Informazioni hotel', icon: <BookOpenText /> },
  { value: 'impostazioni', label: 'Impostazioni', icon: <Settings /> },
]

const INBOX_VIEWS = [
  { value: 'todo', label: 'Da gestire' },
  { value: 'mine', label: 'Assegnate a me' },
  { value: 'replied', label: 'Risposte inviate' },
  { value: 'archived', label: 'Archiviate' },
]

type Access =
  | { status: 'loading' }
  | { status: 'not-entitled' | 'forbidden' | 'error' }
  | { status: 'ready'; canManage: boolean }

// Core-native module (like Turni): entitlement from the runtime context,
// then smart_inbox.view / .manage from has_permission() -- the same checks
// every Smart Inbox RLS policy evaluates server-side.
export function SmartInboxPage() {
  const runtime = useModuleRuntime()
  const propertyId = runtime.property?.id ?? null
  const entitled = runtime.entitlements.some((item) => item.enabled && item.slug === 'smart_inbox')
  const [access, setAccess] = useState<Access>({ status: 'loading' })
  const [tab, setTab] = useState(() => (new URLSearchParams(window.location.search).has('outlook') ? 'impostazioni' : 'posta'))
  const [view, setView] = useState<InboxView>('todo')

  useEffect(() => {
    if (!entitled) {
      setAccess({ status: 'not-entitled' })
      return
    }
    if (!propertyId) return
    let cancelled = false
    setAccess({ status: 'loading' })
    Promise.all([runtime.hasPermission('smart_inbox.view'), runtime.hasPermission('smart_inbox.manage')])
      .then(([view, manage]) => {
        if (cancelled) return
        setAccess(view ? { status: 'ready', canManage: manage } : { status: 'forbidden' })
      })
      .catch(() => {
        if (!cancelled) setAccess({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [entitled, propertyId, runtime])

  if (access.status === 'loading' || !propertyId) return <PageState kind="loading" title="Caricamento Smart Inbox…" />
  if (access.status === 'not-entitled') return <PageState kind="unavailable" title="Smart Inbox non è abilitato per questa struttura." />
  if (access.status === 'forbidden') {
    return <PageState kind="unavailable" title="Non hai accesso a Smart Inbox." description="Chiedi a un responsabile di abilitarti da Team." />
  }
  if (access.status !== 'ready') {
    return (
      <PageState
        kind="error"
        title="Impossibile caricare Smart Inbox."
        description="Riprova tra qualche istante."
        action={{ label: 'Ricarica', onClick: () => window.location.reload() }}
      />
    )
  }

  return (
    <div className="page-stack smart-inbox-page">
      <ModuleNav
        propertyName={runtime.property?.name ?? 'Struttura'}
        moduleName="Smart Inbox"
        items={TABS}
        value={tab}
        onValueChange={setTab}
        ariaLabel="Sezioni Smart Inbox"
        secondary={tab === 'posta' ? {
          items: INBOX_VIEWS,
          value: view,
          onValueChange: (value) => setView(value as InboxView),
          ariaLabel: 'Filtra la posta',
        } : undefined}
      />
      {/* Panels stay mounted (as in Dining) so switching tab never throws
          away a half-edited draft or form. */}
      <div hidden={tab !== 'posta'}><InboxTab client={supabase} propertyId={propertyId} currentProfileId={runtime.profile?.id ?? null} view={view} active={tab === 'posta'} /></div>
      <div hidden={tab !== 'informazioni'}><KnowledgeTab client={supabase} propertyId={propertyId} canManage={access.canManage} /></div>
      <div hidden={tab !== 'impostazioni'}><SettingsTab client={supabase} propertyId={propertyId} canManage={access.canManage} /></div>
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { ModuleNav, useRememberedTab } from '@homisuite/ui'
import { BookOpenText, ClipboardPaste, FileText, Inbox, Settings } from 'lucide-react'
import { PageState } from '../../components/PageState'
import { supabase } from '../../core/client'
import { useModuleRuntime } from '../../core/ModuleRuntimeContext'
import { DEFAULT_SETTINGS, loadSettings, loadSignature } from './api'
import { ComposeTab } from './ComposeTab'
import { InboxTab } from './InboxTab'
import { KnowledgeTab } from './KnowledgeTab'
import { SettingsTab } from './SettingsTab'
import { TemplatesTab } from './TemplatesTab'
import type { InboxView } from './labels'
import type { InboxSettings, SignatureInfo } from './types'
import './smart-inbox.css'

const TABS = [
  { value: 'posta', label: 'Posta', icon: <Inbox /> },
  { value: 'componi', label: 'Componi risposta', icon: <ClipboardPaste /> },
  { value: 'modelli', label: 'Modelli', icon: <FileText /> },
  { value: 'informazioni', label: 'Informazioni hotel', icon: <BookOpenText /> },
  { value: 'impostazioni', label: 'Impostazioni', icon: <Settings /> },
]

const INBOX_VIEWS = [
  { value: 'todo', label: 'Da rispondere' },
  { value: 'mine', label: 'Assegnate a me' },
  { value: 'replied', label: 'Risposto' },
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
  // Both the post-Outlook-auth redirect (?outlook) and the Moduli page's
  // "impostazioni" shortcut (?tab=impostazioni) must always land here
  // regardless of where this module was left on last (see useRememberedTab).
  const query = new URLSearchParams(window.location.search)
  const settingsDeepLink = query.has('outlook') || query.get('tab') === 'impostazioni'
  const [tab, setTab] = useRememberedTab('smartInbox.tab', 'posta', settingsDeepLink ? 'impostazioni' : null)
  const [view, setView] = useRememberedTab('smartInbox.view', 'todo')
  const [settings, setSettings] = useState<InboxSettings>(DEFAULT_SETTINGS)
  const [signature, setSignature] = useState<SignatureInfo | null>(null)
  const propertyName = runtime.property?.name ?? 'Struttura'
  const ready = access.status === 'ready'

  // Settings drive the signature under every reply, the channels offered
  // in Componi risposta and the translation; reloaded after a save.
  const loadReplySettings = useCallback(async () => {
    if (!propertyId) return
    try {
      const next = await loadSettings(supabase, propertyId)
      setSettings(next)
      setSignature(await loadSignature(supabase, propertyId, propertyName, next))
    } catch (cause) {
      console.error('Smart Inbox: reply settings not loaded', cause)
    }
  }, [propertyId, propertyName])

  useEffect(() => { if (ready) void loadReplySettings() }, [ready, loadReplySettings])

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
        propertyName={propertyName}
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
      <div hidden={tab !== 'posta'}>
        <InboxTab
          client={supabase}
          propertyId={propertyId}
          currentProfileId={runtime.profile?.id ?? null}
          view={view as InboxView}
          active={tab === 'posta'}
          signature={signature}
          showTranslation={settings.show_translation}
          onCompose={() => setTab('componi')}
        />
      </div>
      <div hidden={tab !== 'componi'}>
        <ComposeTab
          client={supabase}
          propertyId={propertyId}
          enabledSources={settings.enabled_sources}
          signature={signature}
          showTranslation={settings.show_translation}
          onDone={() => { setView('todo'); setTab('posta') }}
        />
      </div>
      <div hidden={tab !== 'informazioni'}><KnowledgeTab client={supabase} propertyId={propertyId} canManage={access.canManage} /></div>
      <div hidden={tab !== 'modelli'}><TemplatesTab client={supabase} propertyId={propertyId} canManage={access.canManage} /></div>
      <div hidden={tab !== 'impostazioni'}><SettingsTab client={supabase} propertyId={propertyId} propertyName={propertyName} canManage={access.canManage} onSaved={loadReplySettings} /></div>
    </div>
  )
}

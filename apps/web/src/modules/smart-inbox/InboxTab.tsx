import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Button } from '@homisuite/ui'
import { Archive, ArrowLeft, CircleAlert, RefreshCw, RotateCcw, Send, Sparkles, UserCheck } from 'lucide-react'
import { PageState } from '../../components/PageState'
import { assignConversation, listAgents, listMessages, listThread, regenerateDraft, saveDraftBody, sendReply, setMessageStatus, SmartInboxActionError } from './api'
import {
  ACTION_LABELS,
  actionErrorLabel,
  CATEGORY_LABELS,
  groupByConversation,
  ignoreReasonLabel,
  initials,
  isActionable,
  messageErrorLabel,
  STATUS_LABELS,
  statusesForView,
  statusTone,
  URGENCY_LABELS,
  type ConversationGroup,
  type InboxView,
} from './labels'
import type { Agent, InboxMessage } from './types'

const POLL_MS = 30_000

function formatWhen(iso: string): string {
  const date = new Date(iso)
  const sameDay = date.toDateString() === new Date().toDateString()
  return new Intl.DateTimeFormat('it-IT', sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)
}

function readableError(cause: unknown): string {
  return actionErrorLabel(cause instanceof SmartInboxActionError ? cause.code : null)
}

const EMPTY_TITLES: Record<InboxView, string> = {
  todo: 'Nessun ospite in attesa di risposta.',
  mine: 'Nessuna conversazione assegnata a te.',
  replied: 'Nessuna risposta inviata.',
  archived: 'Nessuna email archiviata.',
}

// The inbox is organised by guest: one row per conversation (all emails
// from the same address), each looked after by one agent -- a staff member
// with access to Smart Inbox.
export function InboxTab({ client, propertyId, currentProfileId, view, active }: {
  client: SupabaseClient
  propertyId: string
  currentProfileId: string | null
  view: InboxView
  active: boolean
}) {
  const [messages, setMessages] = useState<InboxMessage[] | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [loadError, setLoadError] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const loadToken = useRef(0)

  const load = useCallback(async () => {
    const token = ++loadToken.current
    try {
      const next = await listMessages(client, propertyId, statusesForView(view))
      if (token !== loadToken.current) return
      setMessages(next)
      setLoadError(false)
    } catch (cause) {
      console.error('Smart Inbox: messages not loaded', cause)
      if (token === loadToken.current) setLoadError(true)
    }
  }, [client, propertyId, view])

  useEffect(() => {
    setMessages(null)
    setSelectedKey(null)
    void load()
  }, [load])

  useEffect(() => {
    let cancelled = false
    listAgents(client, propertyId)
      .then((next) => { if (!cancelled) setAgents(next) })
      .catch((cause) => console.error('Smart Inbox: agents not loaded', cause))
    return () => { cancelled = true }
  }, [client, propertyId])

  // New emails arrive server-side (Graph webhook): refresh periodically
  // while this tab is on screen, and when the window regains focus.
  useEffect(() => {
    if (!active) return
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, POLL_MS)
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [active, load])

  const agentName = useCallback((profileId: string | null) => {
    if (!profileId) return null
    if (profileId === currentProfileId) return 'Tu'
    return agents.find((agent) => agent.profile_id === profileId)?.full_name ?? 'Collega'
  }, [agents, currentProfileId])

  const groups = useMemo(() => {
    const all = groupByConversation(messages ?? [])
    return view === 'mine' ? all.filter((group) => group.assignedTo && group.assignedTo === currentProfileId) : all
  }, [messages, view, currentProfileId])
  const selected = groups.find((group) => group.key === selectedKey) ?? null

  if (loadError && !messages) {
    return <PageState kind="error" title="Impossibile caricare la posta." action={{ label: 'Riprova', onClick: () => void load() }} />
  }
  if (!messages) return <PageState kind="loading" title="Caricamento posta…" />

  return (
    <div className={`smart-inbox-layout${selected ? ' has-selection' : ''}`}>
      <section className="shell-card smart-inbox-list" aria-label="Conversazioni">
        <div className="smart-inbox-list-head">
          <span className="muted">{groups.length === 1 ? '1 ospite' : `${groups.length} ospiti`}</span>
          <button className="icon-button" type="button" onClick={() => void load()} aria-label="Aggiorna"><RefreshCw size={16} /></button>
        </div>
        {groups.length === 0 ? (
          <PageState
            kind="empty"
            title={EMPTY_TITLES[view]}
            description={view === 'todo' ? 'Le nuove email degli ospiti compariranno qui con una bozza di risposta.' : undefined}
          />
        ) : (
          <ul className="smart-inbox-items">
            {groups.map((group) => {
              const assignee = agentName(group.assignedTo)
              return (
                <li key={group.key}>
                  <button
                    type="button"
                    className={`smart-inbox-item${group.key === selectedKey ? ' selected' : ''}`}
                    onClick={() => setSelectedKey(group.key)}
                    aria-current={group.key === selectedKey ? 'true' : undefined}
                  >
                    <span className="smart-inbox-item-top">
                      <span className="smart-inbox-guest">
                        <span className="smart-inbox-avatar" aria-hidden="true">{initials(group.guestName)}</span>
                        <strong>{group.guestName}</strong>
                      </span>
                      <time dateTime={group.latest.received_at}>{formatWhen(group.latest.received_at)}</time>
                    </span>
                    <span className="smart-inbox-item-subject">{group.latest.subject || '(senza oggetto)'}</span>
                    <span className="smart-inbox-item-summary">{group.latest.summary || group.latest.body_preview || ''}</span>
                    <span className="smart-inbox-item-tags">
                      <span className={`smart-inbox-status tone-${statusTone(group.latest.status)}`}>{STATUS_LABELS[group.latest.status]}</span>
                      {group.openCount > 1 ? <span className="status-chip">{group.openCount} email da gestire</span> : null}
                      {group.latest.urgency === 'high' && isActionable(group.latest.status) ? <span className="smart-inbox-status tone-danger">Urgente</span> : null}
                      <span className={`smart-inbox-agent-chip${assignee ? '' : ' unassigned'}`}>
                        <UserCheck size={12} aria-hidden="true" /> {assignee ?? 'Non assegnata'}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {selected ? (
        <ConversationDetail
          key={selected.key}
          client={client}
          group={selected}
          agents={agents}
          currentProfileId={currentProfileId}
          agentName={agentName}
          onBack={() => setSelectedKey(null)}
          onChanged={load}
        />
      ) : (
        <section className="shell-card smart-inbox-detail smart-inbox-detail-empty">
          <PageState kind="empty" title="Seleziona un ospite" description="Vedrai tutte le sue email, le risposte già inviate e la bozza preparata." />
        </section>
      )}
    </div>
  )
}

function ConversationDetail({ client, group, agents, currentProfileId, agentName, onBack, onChanged }: {
  client: SupabaseClient
  group: ConversationGroup<InboxMessage>
  agents: Agent[]
  currentProfileId: string | null
  agentName: (profileId: string | null) => string | null
  onBack: () => void
  onChanged: () => Promise<void>
}) {
  const [thread, setThread] = useState<InboxMessage[] | null>(group.threadId ? null : group.messages)
  const [assigning, setAssigning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latestReceived = group.latest.received_at

  const loadThread = useCallback(async () => {
    if (!group.threadId) return
    try {
      setThread(await listThread(client, group.threadId))
    } catch (cause) {
      console.error('Smart Inbox: conversation not loaded', cause)
      setError('Impossibile caricare la conversazione.')
    }
  }, [client, group.threadId])

  // Reload when the list (polling) brings a newer email for this guest.
  useEffect(() => { void loadThread() }, [loadThread, latestReceived])

  const refresh = useCallback(async () => {
    await Promise.all([loadThread(), onChanged()])
  }, [loadThread, onChanged])

  async function assign(profileId: string | null) {
    if (!group.threadId) return
    setAssigning(true)
    setError(null)
    try {
      await assignConversation(client, group.threadId, profileId)
      await refresh()
    } catch (cause) {
      setError(readableError(cause))
    } finally {
      setAssigning(false)
    }
  }

  const assignedTo = group.assignedTo
  const assignedToOther = assignedTo && assignedTo !== currentProfileId

  return (
    <section className="shell-card smart-inbox-detail" aria-label={`Conversazione con ${group.guestName}`}>
      <div className="smart-inbox-detail-head">
        <button className="secondary-action smart-inbox-back" type="button" onClick={onBack}><ArrowLeft size={16} /> Posta</button>
        <div className="smart-inbox-guest-head">
          <span className="smart-inbox-avatar large" aria-hidden="true">{initials(group.guestName)}</span>
          <div>
            <h2>{group.guestName}</h2>
            {group.guestAddress ? <p className="muted">{group.guestAddress}</p> : null}
          </div>
        </div>
        {group.threadId ? (
          <div className="smart-inbox-assign">
            <label className="form-field">
              <span>Agent</span>
              <select value={assignedTo ?? ''} onChange={(event) => void assign(event.target.value || null)} disabled={assigning}>
                <option value="">Non assegnata</option>
                {agents.map((agent) => (
                  <option key={agent.profile_id} value={agent.profile_id}>
                    {agent.full_name}{agent.profile_id === currentProfileId ? ' (tu)' : ''}
                  </option>
                ))}
              </select>
            </label>
            {currentProfileId && assignedTo !== currentProfileId ? (
              <Button variant="secondary" onClick={() => void assign(currentProfileId)} disabled={assigning}>
                <UserCheck size={15} /> Prendi in carico
              </Button>
            ) : null}
          </div>
        ) : null}
        {assignedToOther ? (
          <p className="smart-inbox-owner-note" role="status">
            <UserCheck size={14} aria-hidden="true" /> Questo ospite lo segue {agentName(assignedTo)}. Puoi comunque rispondere.
          </p>
        ) : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </div>

      {!thread ? (
        <PageState kind="loading" title="Caricamento conversazione…" />
      ) : (
        <ol className="smart-inbox-thread">
          {thread.map((message) => (
            <li key={message.id}>
              <MessageCard client={client} message={message} agentName={agentName} onChanged={refresh} />
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function MessageCard({ client, message, agentName, onChanged }: {
  client: SupabaseClient
  message: InboxMessage
  agentName: (profileId: string | null) => string | null
  onChanged: () => Promise<void>
}) {
  const draft = message.draft
  const actionable = isActionable(message.status)
  const editable = actionable && draft?.status === 'pending'
  const [body, setBody] = useState(draft?.body ?? '')
  const [expanded, setExpanded] = useState(actionable)
  const [busy, setBusy] = useState<null | 'send' | 'save' | 'regenerate' | 'status'>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const dirty = editable && body !== draft?.body

  // A regenerated draft arrives through a reload: adopt it unless the
  // person is in the middle of editing.
  useEffect(() => {
    if (!dirty) setBody(draft?.body ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.body])

  async function run(kind: NonNullable<typeof busy>, action: () => Promise<unknown>, done?: string) {
    setBusy(kind)
    setError(null)
    setNotice(null)
    try {
      await action()
      if (done) setNotice(done)
      await onChanged()
    } catch (cause) {
      setError(readableError(cause))
    } finally {
      setBusy(null)
    }
  }

  const problem = messageErrorLabel(message.error)
  const ignored = message.status === 'ignored' ? ignoreReasonLabel(message.ignore_reason) : null
  const guestText = message.body_text || message.body_preview || 'Contenuto non ancora disponibile.'
  const sentReply = draft?.status === 'sent' ? draft : null

  return (
    <article className={`smart-inbox-message${actionable ? ' open' : ''}`}>
      <header className="smart-inbox-message-head">
        <div>
          <strong>{message.subject || '(senza oggetto)'}</strong>
          <time dateTime={message.received_at}>{formatWhen(message.received_at)}</time>
        </div>
        <div className="smart-inbox-meta">
          <span className={`smart-inbox-status tone-${statusTone(message.status)}`}>{STATUS_LABELS[message.status]}</span>
          {message.category ? <span className="status-chip">{CATEGORY_LABELS[message.category]}</span> : null}
          {actionable && message.urgency ? <span className="status-chip">Urgenza: {URGENCY_LABELS[message.urgency]}</span> : null}
          {actionable && message.language ? <span className="status-chip">Lingua: {message.language.toUpperCase()}</span> : null}
        </div>
      </header>

      {actionable && message.summary ? (
        <p className="smart-inbox-summary"><Sparkles size={15} aria-hidden="true" /> {message.summary}</p>
      ) : null}
      {actionable && problem ? <div className="shell-alert error" role="alert"><span><CircleAlert size={15} aria-hidden="true" /> {problem}</span></div> : null}
      {ignored ? <p className="muted smart-inbox-note">Filtrata automaticamente: {ignored}.</p> : null}

      <div className={`smart-inbox-email-body${expanded ? '' : ' collapsed'}`}>{guestText}</div>
      {!expanded && guestText.length > 180 ? (
        <button className="link-button smart-inbox-expand" type="button" onClick={() => setExpanded(true)}>Mostra tutto</button>
      ) : null}

      {sentReply ? (
        <div className="smart-inbox-reply">
          <p className="smart-inbox-reply-head">
            Risposta inviata{sentReply.sent_by ? ` da ${agentName(sentReply.sent_by) === 'Tu' ? 'te' : agentName(sentReply.sent_by)}` : ''}{sentReply.sent_at ? ` · ${formatWhen(sentReply.sent_at)}` : ''}
          </p>
          <div className="smart-inbox-reply-body">{sentReply.body}</div>
        </div>
      ) : null}

      {actionable && draft && draft.suggested_actions.length > 0 ? (
        <div className="smart-inbox-actions-box">
          <h3>Da organizzare</h3>
          <ul>
            {draft.suggested_actions.map((action, index) => (
              <li key={index}><strong>{ACTION_LABELS[action.type]}:</strong> {action.details}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {actionable ? (
        <div className="smart-inbox-draft">
          <h3>Bozza di risposta</h3>
          {draft && editable ? (
            <label className="form-field">
              <span className="sr-only">Testo della risposta</span>
              <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={12} maxLength={20000} />
            </label>
          ) : (
            <p className="muted">
              {message.status === 'pending' || message.status === 'processing' ? 'La bozza è in preparazione…' : 'Nessuna bozza per questo messaggio.'}
            </p>
          )}
        </div>
      ) : null}

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {notice ? <p className="smart-inbox-notice" role="status">{notice}</p> : null}

      <div className="smart-inbox-buttons">
        {editable ? (
          <Button variant="primary" onClick={() => void run('send', () => sendReply(client, draft!.id, body), 'Risposta inviata.')} disabled={busy !== null || !body.trim()}>
            <Send size={15} /> {busy === 'send' ? 'Invio…' : 'Invia risposta'}
          </Button>
        ) : null}
        {editable && dirty ? (
          <Button variant="secondary" onClick={() => void run('save', () => saveDraftBody(client, draft!.id, body), 'Bozza salvata.')} disabled={busy !== null}>
            {busy === 'save' ? 'Salvataggio…' : 'Salva bozza'}
          </Button>
        ) : null}
        {actionable && message.status !== 'processing' ? (
          <Button variant="secondary" onClick={() => void run('regenerate', () => regenerateDraft(client, message.id))} disabled={busy !== null}>
            <Sparkles size={15} /> {busy === 'regenerate' ? 'Generazione…' : draft ? 'Rigenera bozza' : 'Genera bozza'}
          </Button>
        ) : null}
        {['draft_ready', 'needs_attention', 'failed'].includes(message.status) ? (
          <Button variant="secondary" onClick={() => void run('status', () => setMessageStatus(client, message.id, 'dismissed'))} disabled={busy !== null}>
            <Archive size={15} /> Archivia
          </Button>
        ) : null}
        {message.status === 'dismissed' || message.status === 'ignored' ? (
          <Button variant="secondary" onClick={() => void run('status', () => setMessageStatus(client, message.id, 'needs_attention'))} disabled={busy !== null}>
            <RotateCcw size={15} /> Riporta in Da gestire
          </Button>
        ) : null}
      </div>
    </article>
  )
}

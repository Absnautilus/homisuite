import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Button } from '@homisuite/ui'
import { AlertTriangle, Archive, ArrowLeft, CalendarDays, CheckCircle2, CircleAlert, Clock3, ClipboardPaste, Inbox, RefreshCw, RotateCcw, Sparkles, StickyNote, UserCheck } from 'lucide-react'
import { PageState } from '../../components/PageState'
import {
  assignConversation,
  listAgents,
  listMessages,
  listTemplates,
  listThread,
  loadSummary,
  regenerateDraft,
  setMessageStatus,
  SmartInboxActionError,
  updateConversation,
} from './api'
import {
  actionErrorLabel,
  draftHint,
  groupByConversation,
  ignoreReasonLabel,
  initials,
  isActionable,
  messageErrorLabel,
  monthFromInput,
  monthInputValue,
  monthLabel,
  SIMPLE_STATE_LABELS,
  simpleState,
  SOURCE_LABELS,
  sourceBadge,
  statusesForView,
  type ConversationGroup,
  type InboxView,
} from './labels'
import { ReplyComposer } from './ReplyComposer'
import type { Agent, InboxMessage, MessageSource, ReplyTemplate, SignatureInfo } from './types'

const POLL_MS = 30_000
const NO_MONTH = 'none'

function formatWhen(iso: string): string {
  const date = new Date(iso)
  const sameDay = date.toDateString() === new Date().toDateString()
  return new Intl.DateTimeFormat('it-IT', sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)
}

function readableError(cause: unknown): string {
  return actionErrorLabel(cause instanceof SmartInboxActionError ? cause.code : null)
}

const EMPTY_TITLES: Record<InboxView, string> = {
  todo: 'Nessun ospite da rispondere. Ottimo lavoro!',
  mine: 'Nessun ospite assegnato a te da rispondere.',
  replied: 'Nessuna risposta inviata.',
  archived: 'Nessuna email archiviata.',
}

type Summary = { toAnswer: number; urgent: number; answeredToday: number }

function StateBadge({ status }: { status: InboxMessage['status'] }) {
  const state = simpleState(status)
  const Icon = state === 'answered' ? CheckCircle2 : state === 'to_answer' ? Clock3 : Archive
  return (
    <span className={`smart-inbox-state state-${state}`}>
      <Icon size={13} aria-hidden="true" /> {SIMPLE_STATE_LABELS[state]}
    </span>
  )
}

// The inbox is organised by guest: one row per conversation, each looked
// after by one agent. Designed to answer "who is waiting, and who first?"
// without having to read anything.
export function InboxTab({ client, propertyId, currentProfileId, view, active, signature, showTranslation, onCompose }: {
  client: SupabaseClient
  propertyId: string
  currentProfileId: string | null
  view: InboxView
  active: boolean
  signature: SignatureInfo | null
  showTranslation: boolean
  onCompose: () => void
}) {
  const [messages, setMessages] = useState<InboxMessage[] | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [templates, setTemplates] = useState<ReplyTemplate[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [onlyUrgent, setOnlyUrgent] = useState(false)
  const [month, setMonth] = useState('')
  const [channel, setChannel] = useState<'' | MessageSource>('')
  const [notice, setNotice] = useState<string | null>(null)
  const loadToken = useRef(0)

  const load = useCallback(async () => {
    const token = ++loadToken.current
    try {
      const [next, nextSummary] = await Promise.all([
        listMessages(client, propertyId, statusesForView(view)),
        loadSummary(client, propertyId),
      ])
      if (token !== loadToken.current) return
      setMessages(next)
      setSummary(nextSummary)
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
    Promise.all([listAgents(client, propertyId), listTemplates(client, propertyId)])
      .then(([nextAgents, nextTemplates]) => {
        if (cancelled) return
        setAgents(nextAgents)
        setTemplates(nextTemplates)
      })
      .catch((cause) => console.error('Smart Inbox: agents/templates not loaded', cause))
    return () => { cancelled = true }
  }, [client, propertyId, active])

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

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const agentName = useCallback((profileId: string | null) => {
    if (!profileId) return null
    if (profileId === currentProfileId) return 'Tu'
    return agents.find((agent) => agent.profile_id === profileId)?.full_name ?? 'Collega'
  }, [agents, currentProfileId])

  const allGroups = useMemo(() => {
    const all = groupByConversation(messages ?? [])
    return view === 'mine' ? all.filter((group) => group.assignedTo && group.assignedTo === currentProfileId) : all
  }, [messages, view, currentProfileId])

  const channels = useMemo(() => [...new Set(allGroups.map((group) => group.latest.source))].sort(), [allGroups])

  const months = useMemo(() => {
    const set = new Set(allGroups.map((group) => group.stayMonth).filter((value): value is string => Boolean(value)))
    return [...set].sort()
  }, [allGroups])

  // Urgent guests first, then the ones who have been waiting longest
  // (oldest first) while there is something to answer; newest first
  // otherwise.
  const groups = useMemo(() => {
    const filtered = allGroups.filter((group) =>
      (!onlyUrgent || group.isUrgent)
      && (!channel || group.messages.some((message) => message.source === channel))
      && (!month || (month === NO_MONTH ? !group.stayMonth : group.stayMonth === month)))
    if (view !== 'todo' && view !== 'mine') return filtered
    return [...filtered].sort((a, b) => {
      if (a.isUrgent !== b.isUrgent) return a.isUrgent ? -1 : 1
      return a.latest.received_at < b.latest.received_at ? -1 : 1
    })
  }, [allGroups, onlyUrgent, month, channel, view])

  const selected = groups.find((group) => group.key === selectedKey) ?? allGroups.find((group) => group.key === selectedKey) ?? null

  // After a reply, go straight to the next guest waiting, so nobody has to
  // decide "what now?".
  const handleSent = useCallback((sentKey: string, stillOpen: boolean, done: string) => {
    if (stillOpen || (view !== 'todo' && view !== 'mine')) {
      setNotice(`${done}.`)
      return
    }
    const index = groups.findIndex((group) => group.key === sentKey)
    const next = groups[index + 1] ?? groups[index - 1] ?? null
    setSelectedKey(next ? next.key : null)
    setNotice(next ? `${done}. Ora: ${next.guestName}` : `${done}. Non ci sono altri ospiti da rispondere.`)
  }, [groups, view])

  if (loadError && !messages) {
    return <PageState kind="error" title="Impossibile caricare la posta." action={{ label: 'Riprova', onClick: () => void load() }} />
  }
  if (!messages) return <PageState kind="loading" title="Caricamento posta…" />

  return (
    <div className="page-stack smart-inbox-inbox">
      {summary ? (
        <div className="smart-inbox-summary-bar" role="status" aria-label="Riepilogo">
          <div className={`smart-inbox-counter${summary.toAnswer > 0 ? ' warn' : ' ok'}`}>
            <strong>{summary.toAnswer}</strong><span>{summary.toAnswer === 1 ? 'ospite da rispondere' : 'ospiti da rispondere'}</span>
          </div>
          <div className={`smart-inbox-counter${summary.urgent > 0 ? ' danger' : ''}`}>
            <strong>{summary.urgent}</strong><span>{summary.urgent === 1 ? 'urgente' : 'urgenti'}</span>
          </div>
          <div className="smart-inbox-counter ok">
            <strong>{summary.answeredToday}</strong><span>{summary.answeredToday === 1 ? 'risposta oggi' : 'risposte oggi'}</span>
          </div>
        </div>
      ) : null}
      {notice ? <div className="shell-alert smart-inbox-toast" role="status"><CheckCircle2 size={16} aria-hidden="true" /> {notice}</div> : null}

      <div className={`smart-inbox-layout${selected ? ' has-selection' : ''}`}>
        <section className="shell-card smart-inbox-list" aria-label="Ospiti">
          <div className="smart-inbox-filters">
            <button
              type="button"
              className={`smart-inbox-filter-chip${onlyUrgent ? ' active' : ''}`}
              aria-pressed={onlyUrgent}
              onClick={() => setOnlyUrgent((value) => !value)}
            >
              <AlertTriangle size={13} aria-hidden="true" /> Solo urgenti
            </button>
            {channels.length > 1 || channel ? (
              <label className="smart-inbox-month-filter">
                <Inbox size={14} aria-hidden="true" />
                <span className="sr-only">Canale</span>
                <select value={channel} onChange={(event) => setChannel(event.target.value as '' | MessageSource)}>
                  <option value="">Tutti i canali</option>
                  {channels.map((value) => <option key={value} value={value}>{SOURCE_LABELS[value]}</option>)}
                </select>
              </label>
            ) : null}
            <label className="smart-inbox-month-filter">
              <CalendarDays size={14} aria-hidden="true" />
              <span className="sr-only">Mese del soggiorno</span>
              <select value={month} onChange={(event) => setMonth(event.target.value)}>
                <option value="">Tutti i mesi</option>
                {months.map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}
                <option value={NO_MONTH}>Senza mese</option>
              </select>
            </label>
            <button className="icon-button" type="button" onClick={() => void load()} aria-label="Aggiorna"><RefreshCw size={16} /></button>
          </div>
          {groups.length === 0 ? (
            <PageState
              kind="empty"
              title={onlyUrgent || month || channel ? 'Nessun ospite con questi filtri.' : EMPTY_TITLES[view]}
              description={view === 'todo' && !onlyUrgent && !month && !channel ? 'Le nuove email degli ospiti compariranno qui con una bozza di risposta. Per Booking, WhatsApp e gli altri canali usa Componi risposta.' : undefined}
              action={view === 'todo' && !onlyUrgent && !month && !channel ? { label: 'Componi risposta', onClick: onCompose } : undefined}
            />
          ) : (
            <ul className="smart-inbox-items">
              {groups.map((group) => {
                const assignee = agentName(group.assignedTo)
                const stay = monthLabel(group.stayMonth)
                return (
                  <li key={group.key}>
                    <button
                      type="button"
                      className={`smart-inbox-item${group.key === selectedKey ? ' selected' : ''}${group.isUrgent ? ' urgent' : ''}`}
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
                      <span className="smart-inbox-item-tags">
                        <StateBadge status={group.latest.status} />
                        {group.isUrgent ? <span className="smart-inbox-urgent-badge"><AlertTriangle size={12} aria-hidden="true" /> Urgente</span> : null}
                        <span className={`smart-inbox-source-chip source-${group.latest.source}`}>{sourceBadge(group.latest.source)}</span>
                        {group.openCount > 1 ? <span className="status-chip">{group.openCount} email</span> : null}
                      </span>
                      {group.latest.source === 'outlook' ? <span className="smart-inbox-item-subject">{group.latest.subject || '(senza oggetto)'}</span> : null}
                      <span className="smart-inbox-item-summary">{group.latest.summary || group.latest.body_preview || ''}</span>
                      <span className="smart-inbox-item-tags">
                        {stay ? <span className="smart-inbox-month-chip"><CalendarDays size={12} aria-hidden="true" /> {stay}</span> : null}
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
            templates={templates}
            currentProfileId={currentProfileId}
            agentName={agentName}
            signature={signature}
            showTranslation={showTranslation}
            onBack={() => setSelectedKey(null)}
            onChanged={load}
            onSent={handleSent}
          />
        ) : (
          <section className="shell-card smart-inbox-detail smart-inbox-detail-empty">
            <PageState kind="empty" title="Seleziona un ospite" description="Vedrai tutte le sue email, le risposte già inviate e la bozza preparata." />
          </section>
        )}
      </div>
    </div>
  )
}

function ConversationDetail({ client, group, agents, templates, currentProfileId, agentName, signature, showTranslation, onBack, onChanged, onSent }: {
  client: SupabaseClient
  group: ConversationGroup<InboxMessage>
  agents: Agent[]
  templates: ReplyTemplate[]
  currentProfileId: string | null
  agentName: (profileId: string | null) => string | null
  signature: SignatureInfo | null
  showTranslation: boolean
  onBack: () => void
  onChanged: () => Promise<void>
  onSent: (key: string, stillOpen: boolean, done: string) => void
}) {
  const [thread, setThread] = useState<InboxMessage[] | null>(group.threadId ? null : group.messages)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState(group.notes)
  const [notesSaved, setNotesSaved] = useState(false)
  const latestReceived = group.latest.received_at

  const loadThread = useCallback(async () => {
    if (!group.threadId) return null
    try {
      const next = await listThread(client, group.threadId)
      setThread(next)
      return next
    } catch (cause) {
      console.error('Smart Inbox: conversation not loaded', cause)
      setError('Impossibile caricare la conversazione.')
      return null
    }
  }, [client, group.threadId])

  // Reload when the list (polling) brings a newer email for this guest.
  useEffect(() => { void loadThread() }, [loadThread, latestReceived])

  const refresh = useCallback(async () => {
    await Promise.all([loadThread(), onChanged()])
  }, [loadThread, onChanged])

  async function change(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await refresh()
    } catch (cause) {
      setError(readableError(cause))
    } finally {
      setBusy(false)
    }
  }

  async function saveNotes() {
    if (!group.threadId || notes === group.notes) return
    try {
      await updateConversation(client, group.threadId, { notes })
      setNotesSaved(true)
      window.setTimeout(() => setNotesSaved(false), 2500)
      await onChanged()
    } catch (cause) {
      setError(readableError(cause))
    }
  }

  async function afterSend(done: string) {
    const next = await loadThread()
    const stillOpen = (next ?? []).some((message) => isActionable(message.status))
    await onChanged()
    onSent(group.key, stillOpen, done)
  }

  const assignedTo = group.assignedTo
  const assignedToOther = assignedTo && assignedTo !== currentProfileId
  const threadId = group.threadId

  return (
    <section className="shell-card smart-inbox-detail" aria-label={`Conversazione con ${group.guestName}`}>
      <div className="smart-inbox-detail-head">
        <button className="secondary-action smart-inbox-back" type="button" onClick={onBack}><ArrowLeft size={16} /> Posta</button>
        <div className="smart-inbox-guest-head">
          <span className="smart-inbox-avatar large" aria-hidden="true">{initials(group.guestName)}</span>
          <div>
            <h2>{group.guestName}</h2>
            {group.guestAddress && group.latest.source === 'outlook' ? <p className="muted">{group.guestAddress}</p> : null}
            {group.latest.source !== 'outlook' ? (
              <p className="muted">
                <ClipboardPaste size={12} aria-hidden="true" /> Messaggio da {SOURCE_LABELS[group.latest.source]}
                {group.latest.created_by ? `, incollato da ${agentName(group.latest.created_by) === 'Tu' ? 'te' : agentName(group.latest.created_by)}` : ''}
              </p>
            ) : null}
          </div>
        </div>

        {threadId ? (
          <div className="smart-inbox-triage">
            <button
              type="button"
              className={`smart-inbox-urgent-toggle${group.isUrgent ? ' on' : ''}`}
              aria-pressed={group.isUrgent}
              disabled={busy}
              onClick={() => void change(() => updateConversation(client, threadId, { is_urgent: !group.isUrgent }))}
            >
              <AlertTriangle size={15} aria-hidden="true" /> {group.isUrgent ? 'Urgente' : 'Non urgente'}
            </button>
            <label className="form-field smart-inbox-month-field">
              <span>Mese del soggiorno</span>
              <input
                type="month"
                value={monthInputValue(group.stayMonth)}
                disabled={busy}
                onChange={(event) => void change(() => updateConversation(client, threadId, { stay_month: monthFromInput(event.target.value) }))}
              />
            </label>
            <label className="form-field smart-inbox-agent-field">
              <span>Agent</span>
              <select value={assignedTo ?? ''} onChange={(event) => void change(() => assignConversation(client, threadId, event.target.value || null))} disabled={busy}>
                <option value="">Non assegnata</option>
                {agents.map((agent) => (
                  <option key={agent.profile_id} value={agent.profile_id}>
                    {agent.full_name}{agent.profile_id === currentProfileId ? ' (tu)' : ''}
                  </option>
                ))}
              </select>
            </label>
            {currentProfileId && assignedTo !== currentProfileId ? (
              <Button variant="secondary" onClick={() => void change(() => assignConversation(client, threadId, currentProfileId))} disabled={busy}>
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

        {threadId ? (
          <label className="form-field smart-inbox-notes">
            <span><StickyNote size={12} aria-hidden="true" /> Note sull'ospite {notesSaved ? <em className="smart-inbox-saved">Salvato</em> : null}</span>
            <textarea
              rows={2}
              maxLength={4000}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              onBlur={() => void saveNotes()}
              placeholder="Es. cliente abituale, anniversario il 14, allergia alle noci. Le vede tutto lo staff e l'assistente."
            />
          </label>
        ) : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </div>

      {!thread ? (
        <PageState kind="loading" title="Caricamento conversazione…" />
      ) : (
        <ol className="smart-inbox-thread">
          {thread.map((message) => (
            <li key={message.id}>
              <MessageCard
                client={client}
                message={message}
                guestName={group.guestName}
                templates={templates}
                agentName={agentName}
                signature={signature}
                showTranslation={showTranslation}
                onChanged={refresh}
                onSent={afterSend}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function MessageCard({ client, message, guestName, templates, agentName, signature, showTranslation, onChanged, onSent }: {
  client: SupabaseClient
  message: InboxMessage
  guestName: string
  templates: ReplyTemplate[]
  agentName: (profileId: string | null) => string | null
  signature: SignatureInfo | null
  showTranslation: boolean
  onChanged: () => Promise<void>
  onSent: (done: string) => Promise<void>
}) {
  const draft = message.draft
  const actionable = isActionable(message.status)
  const editable = actionable && draft?.status === 'pending'
  const [expanded, setExpanded] = useState(actionable)
  const [busy, setBusy] = useState<null | 'regenerate' | 'status'>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(kind: NonNullable<typeof busy>, action: () => Promise<unknown>) {
    setBusy(kind)
    setError(null)
    try {
      await action()
      await onChanged()
    } catch (cause) {
      setError(readableError(cause))
    } finally {
      setBusy(null)
    }
  }

  const problem = messageErrorLabel(message.error)
  const ignored = message.status === 'ignored' ? ignoreReasonLabel(message.ignore_reason) : null
  const hint = draftHint(message.status, Boolean(draft))
  const guestText = message.body_text || message.body_preview || 'Contenuto non ancora disponibile.'
  const sentReply = draft?.status === 'sent' ? draft : null
  const sentBy = sentReply?.sent_by ? agentName(sentReply.sent_by) : null
  const pasted = message.source !== 'outlook'

  return (
    <article className={`smart-inbox-message${actionable ? ' open' : ''}`}>
      <header className="smart-inbox-message-head">
        <div>
          <strong>{pasted ? `Da ${SOURCE_LABELS[message.source]}` : message.subject || '(senza oggetto)'}</strong>
          <time dateTime={message.received_at}>{formatWhen(message.received_at)}</time>
        </div>
        <div className="smart-inbox-meta">
          <StateBadge status={message.status} />
          {actionable && hint ? <span className="smart-inbox-hint">{hint}</span> : null}
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
            <CheckCircle2 size={13} aria-hidden="true" /> {pasted ? `Risposto su ${SOURCE_LABELS[message.source]}` : 'Risposto'}{sentBy ? ` da ${sentBy === 'Tu' ? 'te' : sentBy}` : ''}{sentReply.sent_at ? ` · ${formatWhen(sentReply.sent_at)}` : ''}
          </p>
          <div className="smart-inbox-reply-body">{sentReply.body}</div>
        </div>
      ) : null}

      {editable && draft ? (
        <ReplyComposer
          client={client}
          message={message}
          draft={draft}
          guestName={guestName}
          templates={templates}
          signature={signature}
          showTranslation={showTranslation}
          onChanged={onChanged}
          onSent={({ copied }) => onSent(pasted ? (copied ? 'Risposta copiata e segnata come risposta' : 'Segnata come risposta: copia il testo dallo storico') : 'Risposta inviata')}
        />
      ) : null}
      {actionable && !draft ? (
        <p className="muted smart-inbox-note">
          {message.status === 'pending' || message.status === 'processing' ? 'La bozza è in preparazione…' : 'Nessuna bozza: puoi generarla con un clic.'}
        </p>
      ) : null}

      {error ? <p className="form-error" role="alert">{error}</p> : null}

      <div className="smart-inbox-buttons">
        {actionable && message.status !== 'processing' ? (
          <Button variant="secondary" onClick={() => void run('regenerate', () => regenerateDraft(client, message.id))} disabled={busy !== null}>
            <Sparkles size={15} /> {busy === 'regenerate' ? 'Generazione…' : draft ? 'Rigenera bozza' : 'Genera bozza'}
          </Button>
        ) : null}
        {['draft_ready', 'needs_attention', 'failed'].includes(message.status) ? (
          <Button variant="secondary" onClick={() => void run('status', () => setMessageStatus(client, message.id, 'dismissed'))} disabled={busy !== null}>
            <Archive size={15} /> Non serve rispondere
          </Button>
        ) : null}
        {message.status === 'dismissed' || message.status === 'ignored' ? (
          <Button variant="secondary" onClick={() => void run('status', () => setMessageStatus(client, message.id, 'needs_attention'))} disabled={busy !== null}>
            <RotateCcw size={15} /> Riporta in Da rispondere
          </Button>
        ) : null}
      </div>
    </article>
  )
}

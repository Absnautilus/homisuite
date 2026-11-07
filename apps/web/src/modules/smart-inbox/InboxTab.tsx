import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Button } from '@homisuite/ui'
import { Archive, ArrowLeft, CircleAlert, RefreshCw, RotateCcw, Send, Sparkles } from 'lucide-react'
import { PageState } from '../../components/PageState'
import { listMessages, regenerateDraft, saveDraftBody, sendReply, setMessageStatus, SmartInboxActionError } from './api'
import {
  ACTION_LABELS,
  actionErrorLabel,
  CATEGORY_LABELS,
  formatSender,
  ignoreReasonLabel,
  messageErrorLabel,
  STATUS_LABELS,
  statusesForView,
  statusTone,
  URGENCY_LABELS,
  type InboxView,
} from './labels'
import type { InboxMessage } from './types'

const POLL_MS = 30_000

function formatReceived(iso: string): string {
  const date = new Date(iso)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  return new Intl.DateTimeFormat('it-IT', sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)
}

function readableError(cause: unknown): string {
  return actionErrorLabel(cause instanceof SmartInboxActionError ? cause.code : null)
}

export function InboxTab({ client, propertyId, view, active }: { client: SupabaseClient; propertyId: string; view: InboxView; active: boolean }) {
  const [messages, setMessages] = useState<InboxMessage[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
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
    setSelectedId(null)
    void load()
  }, [load])

  // New emails arrive server-side (Graph webhook): refresh periodically
  // while this tab is on screen, and immediately when the window regains
  // focus.
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

  const selected = useMemo(() => messages?.find((item) => item.id === selectedId) ?? null, [messages, selectedId])

  if (loadError && !messages) {
    return <PageState kind="error" title="Impossibile caricare la posta." action={{ label: 'Riprova', onClick: () => void load() }} />
  }
  if (!messages) return <PageState kind="loading" title="Caricamento posta…" />

  return (
    <div className={`smart-inbox-layout${selected ? ' has-selection' : ''}`}>
      <section className="shell-card smart-inbox-list" aria-label="Messaggi">
        <div className="smart-inbox-list-head">
          <span className="muted">{messages.length === 1 ? '1 messaggio' : `${messages.length} messaggi`}</span>
          <button className="icon-button" type="button" onClick={() => void load()} aria-label="Aggiorna"><RefreshCw size={16} /></button>
        </div>
        {messages.length === 0 ? (
          <PageState
            kind="empty"
            title={view === 'todo' ? 'Nessuna email da gestire.' : view === 'replied' ? 'Nessuna risposta inviata.' : 'Nessuna email archiviata.'}
            description={view === 'todo' ? 'Le nuove email degli ospiti compariranno qui con una bozza di risposta.' : undefined}
          />
        ) : (
          <ul className="smart-inbox-items">
            {messages.map((message) => (
              <li key={message.id}>
                <button
                  type="button"
                  className={`smart-inbox-item${message.id === selectedId ? ' selected' : ''}`}
                  onClick={() => setSelectedId(message.id)}
                  aria-current={message.id === selectedId ? 'true' : undefined}
                >
                  <span className="smart-inbox-item-top">
                    <strong>{formatSender(message)}</strong>
                    <time dateTime={message.received_at}>{formatReceived(message.received_at)}</time>
                  </span>
                  <span className="smart-inbox-item-subject">{message.subject || '(senza oggetto)'}</span>
                  <span className="smart-inbox-item-summary">{message.summary || message.body_preview || ''}</span>
                  <span className="smart-inbox-item-tags">
                    <span className={`smart-inbox-status tone-${statusTone(message.status)}`}>{STATUS_LABELS[message.status]}</span>
                    {message.category ? <span className="status-chip">{CATEGORY_LABELS[message.category]}</span> : null}
                    {message.urgency === 'high' ? <span className="smart-inbox-status tone-danger">Urgente</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected ? (
        <MessageDetail
          key={selected.id}
          client={client}
          message={selected}
          onBack={() => setSelectedId(null)}
          onChanged={load}
        />
      ) : (
        <section className="shell-card smart-inbox-detail smart-inbox-detail-empty">
          <PageState kind="empty" title="Seleziona un'email" description="Vedrai il messaggio dell'ospite e la bozza di risposta preparata." />
        </section>
      )}
    </div>
  )
}

function MessageDetail({ client, message, onBack, onChanged }: { client: SupabaseClient; message: InboxMessage; onBack: () => void; onChanged: () => Promise<void> }) {
  const draft = message.draft
  const editable = draft?.status === 'pending' && message.status !== 'replied'
  const [body, setBody] = useState(draft?.body ?? '')
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

  return (
    <section className="shell-card smart-inbox-detail" aria-label="Dettaglio messaggio">
      <div className="smart-inbox-detail-head">
        <button className="secondary-action smart-inbox-back" type="button" onClick={onBack}><ArrowLeft size={16} /> Posta</button>
        <div>
          <h2>{message.subject || '(senza oggetto)'}</h2>
          <p className="muted">
            {formatSender(message)}
            {message.from_address && message.from_name ? ` · ${message.from_address}` : ''}
            {' · '}
            {formatReceived(message.received_at)}
          </p>
        </div>
      </div>

      <div className="smart-inbox-meta">
        <span className={`smart-inbox-status tone-${statusTone(message.status)}`}>{STATUS_LABELS[message.status]}</span>
        {message.category ? <span className="status-chip">{CATEGORY_LABELS[message.category]}</span> : null}
        {message.urgency ? <span className="status-chip">Urgenza: {URGENCY_LABELS[message.urgency]}</span> : null}
        {message.language ? <span className="status-chip">Lingua: {message.language.toUpperCase()}</span> : null}
      </div>

      {message.summary ? (
        <p className="smart-inbox-summary"><Sparkles size={15} aria-hidden="true" /> {message.summary}</p>
      ) : null}
      {problem ? <div className="shell-alert error" role="alert"><span><CircleAlert size={15} aria-hidden="true" /> {problem}</span></div> : null}
      {ignored ? <p className="muted smart-inbox-note">Filtrata automaticamente: {ignored}.</p> : null}

      <div className="smart-inbox-email">
        <h3>Messaggio dell'ospite</h3>
        <div className="smart-inbox-email-body">{message.body_text || message.body_preview || 'Contenuto non ancora disponibile.'}</div>
      </div>

      {draft && draft.suggested_actions.length > 0 ? (
        <div className="smart-inbox-actions-box">
          <h3>Da organizzare</h3>
          <ul>
            {draft.suggested_actions.map((action, index) => (
              <li key={index}><strong>{ACTION_LABELS[action.type]}:</strong> {action.details}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="smart-inbox-draft">
        <h3>{draft?.status === 'sent' ? 'Risposta inviata' : 'Bozza di risposta'}</h3>
        {draft ? (
          <label className="form-field">
            <span className="sr-only">Testo della risposta</span>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              readOnly={!editable}
              rows={12}
              maxLength={20000}
            />
          </label>
        ) : (
          <p className="muted">
            {message.status === 'pending' || message.status === 'processing'
              ? 'La bozza è in preparazione…'
              : 'Nessuna bozza per questo messaggio.'}
          </p>
        )}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {notice ? <p className="smart-inbox-notice" role="status">{notice}</p> : null}

        <div className="smart-inbox-buttons">
          {editable ? (
            <Button
              variant="primary"
              onClick={() => void run('send', () => sendReply(client, draft!.id, body), 'Risposta inviata.')}
              disabled={busy !== null || !body.trim()}
            >
              <Send size={15} /> {busy === 'send' ? 'Invio…' : 'Invia risposta'}
            </Button>
          ) : null}
          {editable && dirty ? (
            <Button variant="secondary" onClick={() => void run('save', () => saveDraftBody(client, draft!.id, body), 'Bozza salvata.')} disabled={busy !== null}>
              {busy === 'save' ? 'Salvataggio…' : 'Salva bozza'}
            </Button>
          ) : null}
          {message.status !== 'replied' && message.status !== 'processing' ? (
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
      </div>
    </section>
  )
}

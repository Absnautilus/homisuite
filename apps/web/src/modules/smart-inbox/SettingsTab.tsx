import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Button } from '@homisuite/ui'
import { CircleAlert, Mail, Unplug } from 'lucide-react'
import { PageState } from '../../components/PageState'
import { Switch } from '../../components/Switch'
import { useConfirm } from '../../components/ConfirmDialog'
import { disconnectOutlook, loadMailbox, loadMonthUsage, loadSettings, saveSettings, SmartInboxActionError, startOutlookConnection } from './api'
import { actionErrorLabel, parseSenderList, summarizeUsage, type UsageSummary } from './labels'
import type { InboxSettings, Mailbox, Tone } from './types'

const OUTLOOK_RESULTS: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: 'Casella Outlook collegata. Le nuove email arriveranno in Posta.' },
  denied: { ok: false, text: 'Collegamento annullato su Microsoft.' },
  invalid_state: { ok: false, text: 'Il collegamento è scaduto. Riprova.' },
  no_offline_access: { ok: false, text: 'Microsoft non ha concesso l\'accesso permanente alla casella. Riprova e accetta tutte le autorizzazioni.' },
  invalid_request: { ok: false, text: 'Collegamento non riuscito. Riprova.' },
  error: { ok: false, text: 'Collegamento non riuscito. Riprova; se il problema continua, contatta l\'assistenza.' },
}

const TONES: Array<{ value: Tone; label: string }> = [
  { value: 'cordiale', label: 'Cordiale' },
  { value: 'formale', label: 'Formale' },
  { value: 'essenziale', label: 'Essenziale' },
]

function readOutlookResult(): string | null {
  const params = new URLSearchParams(window.location.search)
  const result = params.get('outlook')
  if (!result) return null
  params.delete('outlook')
  const query = params.toString()
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
  return result
}

export function SettingsTab({ client, propertyId, canManage }: { client: SupabaseClient; propertyId: string; canManage: boolean }) {
  const [mailbox, setMailbox] = useState<Mailbox | null>(null)
  const [settings, setSettings] = useState<InboxSettings | null>(null)
  const [sendersText, setSendersText] = useState('')
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [outlookResult] = useState(readOutlookResult)
  const [busy, setBusy] = useState<null | 'connect' | 'disconnect' | 'save'>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [confirmDialog, confirm] = useConfirm()

  const load = useCallback(async () => {
    try {
      const [nextMailbox, nextSettings, usageRows] = await Promise.all([
        loadMailbox(client, propertyId),
        loadSettings(client, propertyId),
        canManage ? loadMonthUsage(client, propertyId) : Promise.resolve(null),
      ])
      setMailbox(nextMailbox)
      setSettings(nextSettings)
      setSendersText(nextSettings.ignored_senders.join('\n'))
      setUsage(usageRows ? summarizeUsage(usageRows) : null)
      setLoadFailed(false)
    } catch (cause) {
      console.error('Smart Inbox: settings not loaded', cause)
      setLoadFailed(true)
    }
  }, [client, propertyId, canManage])

  useEffect(() => { void load() }, [load])

  async function connect() {
    setBusy('connect')
    setError(null)
    try {
      const { url } = await startOutlookConnection(client, propertyId)
      window.location.assign(url)
    } catch (cause) {
      setError(actionErrorLabel(cause instanceof SmartInboxActionError ? cause.code : null))
      setBusy(null)
    }
  }

  async function disconnect() {
    const confirmed = await confirm({
      title: 'Scollegare la casella Outlook?',
      description: 'Le nuove email non arriveranno più in Smart Inbox. Le email e le bozze già presenti restano consultabili.',
      confirmLabel: 'Scollega',
    })
    if (!confirmed) return
    setBusy('disconnect')
    setError(null)
    try {
      await disconnectOutlook(client, propertyId)
      await load()
    } catch (cause) {
      setError(actionErrorLabel(cause instanceof SmartInboxActionError ? cause.code : null))
    } finally {
      setBusy(null)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!settings) return
    setBusy('save')
    setError(null)
    setSaved(false)
    try {
      const next = { ...settings, ignored_senders: parseSenderList(sendersText) }
      await saveSettings(client, propertyId, next)
      setSettings(next)
      setSendersText(next.ignored_senders.join('\n'))
      setSaved(true)
    } catch {
      setError('Impostazioni non salvate. Riprova.')
    } finally {
      setBusy(null)
    }
  }

  if (loadFailed && !settings) {
    return <PageState kind="error" title="Impossibile caricare le impostazioni." action={{ label: 'Riprova', onClick: () => void load() }} />
  }
  if (!settings) return <PageState kind="loading" title="Caricamento impostazioni…" />

  const result = outlookResult ? OUTLOOK_RESULTS[outlookResult] ?? OUTLOOK_RESULTS.error : null
  const connected = mailbox && mailbox.status !== 'disconnected'
  const needsReconnect = mailbox?.status === 'error'

  return (
    <div className="page-stack">
      {result ? <div className={`shell-alert${result.ok ? '' : ' error'}`} role="status">{result.text}</div> : null}
      {error ? <div className="shell-alert error" role="alert">{error}</div> : null}

      <section className="shell-card">
        <div className="section-heading">
          <h2>Casella Outlook</h2>
          <p>Smart Inbox legge le nuove email arrivate in Posta in arrivo e prepara le bozze. Niente viene inviato senza conferma.</p>
        </div>
        <div className="smart-inbox-mailbox">
          <span className="icon-tile"><Mail size={17} /></span>
          <div className="smart-inbox-mailbox-text">
            {connected ? (
              <>
                <strong>{mailbox.email_address}</strong>
                <span className={needsReconnect ? 'smart-inbox-warn' : 'muted'}>
                  {needsReconnect
                    ? <><CircleAlert size={13} aria-hidden="true" /> Microsoft chiede di ricollegare la casella.</>
                    : 'Collegata'}
                </span>
              </>
            ) : (
              <>
                <strong>Nessuna casella collegata</strong>
                <span className="muted">Accedi con l'account Microsoft 365 della casella da gestire (es. info@ o reservations@).</span>
              </>
            )}
          </div>
          {canManage ? (
            <div className="smart-inbox-mailbox-actions">
              {(!connected || needsReconnect) ? (
                <Button variant="primary" onClick={() => void connect()} disabled={busy !== null}>
                  {busy === 'connect' ? 'Apertura Microsoft…' : needsReconnect ? 'Ricollega Outlook' : 'Collega Outlook'}
                </Button>
              ) : null}
              {connected ? (
                <Button variant="secondary" onClick={() => void disconnect()} disabled={busy !== null}>
                  <Unplug size={15} /> {busy === 'disconnect' ? 'Scollegamento…' : 'Scollega'}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        {!canManage ? <p className="muted smart-inbox-note">Solo un responsabile può collegare o scollegare la casella.</p> : null}
      </section>

      <section className="shell-card">
        <div className="section-heading">
          <h2>Risposte</h2>
          <p>Come l'assistente scrive le bozze per questa struttura.</p>
        </div>
        <form className="modal-form smart-inbox-settings-form" onSubmit={submit}>
          <label className="form-field">
            <span>Firma</span>
            <textarea
              rows={3}
              maxLength={2000}
              value={settings.reply_signature}
              onChange={(event) => setSettings({ ...settings, reply_signature: event.target.value })}
              placeholder={'Cordiali saluti,\nFront Office — Hotel'}
              disabled={!canManage}
            />
          </label>
          <label className="form-field">
            <span>Tono</span>
            <select value={settings.tone} onChange={(event) => setSettings({ ...settings, tone: event.target.value as Tone })} disabled={!canManage}>
              {TONES.map((tone) => <option key={tone.value} value={tone.value}>{tone.label}</option>)}
            </select>
          </label>
          <div className="smart-inbox-toggle-row">
            <div>
              <strong>Prepara le bozze automaticamente</strong>
              <p className="muted">Se disattivato, le email arrivano in Posta e la bozza si genera solo quando la chiedi.</p>
            </div>
            <Switch checked={settings.auto_draft} onChange={() => setSettings({ ...settings, auto_draft: !settings.auto_draft })} aria-label="Prepara le bozze automaticamente" disabled={!canManage} />
          </div>
          <label className="form-field">
            <span>Mittenti da ignorare</span>
            <textarea
              rows={4}
              value={sendersText}
              onChange={(event) => setSendersText(event.target.value)}
              placeholder={'fornitore.it\namministrazione@partner.it'}
              disabled={!canManage}
            />
            <small>Un indirizzo o un dominio per riga. Le notifiche dei portali (Booking, Expedia…), le newsletter e le risposte automatiche sono già escluse.</small>
          </label>
          {canManage ? (
            <div className="smart-inbox-buttons">
              <Button variant="primary" type="submit" disabled={busy !== null}>{busy === 'save' ? 'Salvataggio…' : 'Salva impostazioni'}</Button>
              {saved ? <span className="smart-inbox-notice" role="status">Salvato.</span> : null}
            </div>
          ) : null}
        </form>
      </section>

      {usage ? (
        <section className="shell-card">
          <div className="section-heading">
            <h2>Consumo di questo mese</h2>
            <p>Stima indicativa del costo dell'assistente. Il dato di fatturazione ufficiale è nella console Anthropic.</p>
          </div>
          <dl className="smart-inbox-usage">
            <div><dt>Email elaborate</dt><dd>{usage.calls.toLocaleString('it-IT')}</dd></div>
            <div><dt>Token letti / scritti</dt><dd>{usage.inputTokens.toLocaleString('it-IT')} / {usage.outputTokens.toLocaleString('it-IT')}</dd></div>
            <div><dt>Costo stimato</dt><dd>{usage.estimatedUsd === null ? 'n.d.' : `$ ${usage.estimatedUsd.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</dd></div>
          </dl>
        </section>
      ) : null}
      {confirmDialog}
    </div>
  )
}

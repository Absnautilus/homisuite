import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Button } from '@homisuite/ui'
import { BookOpenText, CheckCircle2, CircleAlert, ClipboardPaste, FileText, Plus, Sparkles } from 'lucide-react'
import { PageState } from '../../components/PageState'
import { composeReply, getMessage, listTemplates, regenerateDraft, SmartInboxActionError } from './api'
import { actionErrorLabel, GUEST_DETAIL_LABELS, languageName, messageErrorLabel, PASTED_SOURCES, SOURCE_LABELS } from './labels'
import { ReplyComposer } from './ReplyComposer'
import type { InboxMessage, PastedSource, ReplyTemplate, SignatureInfo } from './types'

const PLACEHOLDER = 'Hallo,\nwir kommen am 14.12. erst gegen 23 Uhr an, ist ein später Check-in möglich? Gibt es Parkplätze in der Nähe?\nDanke, Lukas Weber'

function readableError(cause: unknown): string {
  return actionErrorLabel(cause instanceof SmartInboxActionError ? cause.code : null)
}

// For messages that don't arrive by themselves (Booking.com/Expedia/Airbnb
// extranets, WhatsApp, a phone call): paste the guest's words, and the
// assistant reads the data, picks and fills the templates, uses the hotel
// information and writes the reply in the guest's language, signed by you.
// The message then lives in Posta with the rest of the guest's history.
export function ComposeTab({ client, propertyId, enabledSources, signature, showTranslation, onDone }: {
  client: SupabaseClient
  propertyId: string
  enabledSources: PastedSource[]
  signature: SignatureInfo | null
  showTranslation: boolean
  onDone: () => void
}) {
  const sources = PASTED_SOURCES.filter((source) => enabledSources.includes(source))
  const [source, setSource] = useState<PastedSource>(sources[0] ?? 'other')
  const [guestName, setGuestName] = useState('')
  const [text, setText] = useState('')
  const [message, setMessage] = useState<InboxMessage | null>(null)
  const [templates, setTemplates] = useState<ReplyTemplate[]>([])
  const [busy, setBusy] = useState<null | 'compose' | 'regenerate'>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    if (!sources.includes(source) && sources[0]) setSource(sources[0])
  }, [sources, source])

  useEffect(() => {
    let cancelled = false
    listTemplates(client, propertyId)
      .then((next) => { if (!cancelled) setTemplates(next) })
      .catch((cause) => console.error('Smart Inbox: templates not loaded', cause))
    return () => { cancelled = true }
  }, [client, propertyId])

  const reload = useCallback(async () => {
    if (!message) return
    const next = await getMessage(client, message.id)
    if (next) setMessage(next)
  }, [client, message])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!text.trim()) {
      setError('Incolla prima il messaggio dell\'ospite.')
      return
    }
    setBusy('compose')
    setError(null)
    setDone(null)
    try {
      const result = await composeReply(client, propertyId, { source, text, guestName })
      setMessage(await getMessage(client, result.messageId))
    } catch (cause) {
      setError(readableError(cause))
    } finally {
      setBusy(null)
    }
  }

  function reset() {
    setMessage(null)
    setText('')
    setGuestName('')
    setError(null)
    setDone(null)
  }

  if (sources.length === 0) {
    return (
      <PageState
        kind="unavailable"
        icon={ClipboardPaste}
        title="Nessun canale da incollare attivo."
        description="Un responsabile può attivare Booking.com, WhatsApp e gli altri canali in Impostazioni."
      />
    )
  }

  const draft = message?.draft ?? null
  const details = message?.guest_details ?? {}
  const requests = details.requests ?? []
  const language = languageName(message?.language ?? null)
  const name = message?.conversation?.guest_name || message?.from_name || 'Ospite'

  return (
    <div className="smart-inbox-compose">
      <section className="shell-card smart-inbox-compose-step">
        <h2><span className="smart-inbox-step">1</span> Messaggio dell'ospite</h2>
        <form className="modal-form" onSubmit={submit}>
          <fieldset className="smart-inbox-sources" disabled={busy !== null || Boolean(message)}>
            <legend>Da dove arriva</legend>
            {sources.map((value) => (
              <label key={value} className={`smart-inbox-filter-chip${source === value ? ' active' : ''}`}>
                <input type="radio" name="source" value={value} checked={source === value} onChange={() => setSource(value)} className="sr-only" />
                {SOURCE_LABELS[value]}
              </label>
            ))}
          </fieldset>
          <label className="form-field">
            <span>Nome dell'ospite <em className="muted">(facoltativo)</em></span>
            <input value={guestName} onChange={(event) => setGuestName(event.target.value)} maxLength={200} placeholder="Se lo lasci vuoto lo legge dal messaggio" disabled={busy !== null || Boolean(message)} />
          </label>
          <label className="form-field">
            <span>Incolla qui il messaggio</span>
            <textarea value={text} onChange={(event) => setText(event.target.value)} rows={10} maxLength={40000} placeholder={PLACEHOLDER} disabled={busy !== null || Boolean(message)} />
          </label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {message ? (
            <Button variant="secondary" onClick={reset}><Plus size={15} /> Nuovo messaggio</Button>
          ) : (
            <Button variant="primary" type="submit" disabled={busy !== null || !text.trim()}>
              <Sparkles size={15} /> {busy === 'compose' ? 'Sto preparando la risposta…' : 'Prepara la risposta'}
            </Button>
          )}
          {language && message ? (
            <p className="muted smart-inbox-note">
              Lingua riconosciuta: {language}{message.language?.startsWith('it') ? '.' : ` · la risposta è in ${language}${showTranslation ? ', con traduzione italiana sotto' : ''}.`}
            </p>
          ) : null}
        </form>
      </section>

      <section className="shell-card smart-inbox-compose-step" aria-busy={busy === 'compose'}>
        <h2><span className="smart-inbox-step">2</span> Dati trovati</h2>
        {!message ? (
          <p className="muted smart-inbox-note">Qui vedrai cosa ha capito l'assistente: date, ospiti, numero di prenotazione, cosa chiede, i modelli e le informazioni che usa.</p>
        ) : (
          <div className="smart-inbox-found">
            <dl className="smart-inbox-details">
              <div><dt>Nome</dt><dd>{name}</dd></div>
              {GUEST_DETAIL_LABELS.map(([key, label]) => (
                <div key={key} className={details[key] ? '' : 'missing'}>
                  <dt>{label}</dt>
                  <dd>{details[key] || '—'}</dd>
                </div>
              ))}
            </dl>
            {requests.length > 0 ? (
              <div>
                <h3>Cosa chiede</h3>
                <ul className="smart-inbox-requests">{requests.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            ) : null}
            <div>
              <h3>Modelli scelti</h3>
              {draft && draft.templates_used.length > 0 ? (
                <p className="smart-inbox-used">{draft.templates_used.map((title) => <span key={title} className="smart-inbox-chip template"><FileText size={12} aria-hidden="true" /> {title}</span>)}</p>
              ) : <p className="muted smart-inbox-note">Nessun modello adatto: la risposta è scritta dalle informazioni.</p>}
            </div>
            <div>
              <h3>Informazioni usate</h3>
              {draft && draft.info_used.length > 0 ? (
                <p className="smart-inbox-used">{draft.info_used.map((title) => <span key={title} className="smart-inbox-chip info"><BookOpenText size={12} aria-hidden="true" /> {title}</span>)}</p>
              ) : <p className="muted smart-inbox-note">Nessuna.</p>}
            </div>
            {message.missing_info.length > 0 ? (
              <p className="smart-inbox-missing" role="note">
                <CircleAlert size={14} aria-hidden="true" /> Non trovo la risposta a: {message.missing_info.join(', ')}. Aggiungila in Informazioni hotel.
              </p>
            ) : null}
          </div>
        )}
      </section>

      <section className="shell-card smart-inbox-compose-step smart-inbox-compose-reply">
        <h2><span className="smart-inbox-step">3</span> Risposta</h2>
        {done ? (
          <div className="smart-inbox-done" role="status">
            <CheckCircle2 size={18} aria-hidden="true" />
            <div>
              <strong>{done}</strong>
              <p className="muted">La trovi in Posta › Risposto, nello storico di {name}.</p>
            </div>
            <div className="smart-inbox-buttons">
              <Button variant="primary" onClick={reset}><Plus size={15} /> Nuovo messaggio</Button>
              <Button variant="secondary" onClick={onDone}>Vai alla Posta</Button>
            </div>
          </div>
        ) : !message ? (
          <p className="muted smart-inbox-note">La risposta pronta, firmata con il tuo nome, comparirà qui.</p>
        ) : draft && draft.status === 'pending' ? (
          <ReplyComposer
            key={draft.id}
            client={client}
            message={message}
            draft={draft}
            guestName={name}
            templates={templates}
            signature={signature}
            showTranslation={showTranslation}
            showSources={false}
            onChanged={reload}
            onSent={({ copied }) => {
              setDone(copied ? `Risposta copiata: incollala in ${SOURCE_LABELS[message.source]}.` : 'Segnata come risposta.')
            }}
          />
        ) : (
          <div className="smart-inbox-found">
            <p className="shell-alert error" role="alert">
              <CircleAlert size={15} aria-hidden="true" /> {messageErrorLabel(message.error) ?? 'L\'assistente non ha preparato una bozza: questo messaggio va gestito a mano.'}
            </p>
            <Button
              variant="secondary"
              disabled={busy !== null}
              onClick={async () => {
                setBusy('regenerate')
                setError(null)
                try {
                  await regenerateDraft(client, message.id)
                  await reload()
                } catch (cause) {
                  setError(readableError(cause))
                } finally {
                  setBusy(null)
                }
              }}
            >
              <Sparkles size={15} /> {busy === 'regenerate' ? 'Generazione…' : 'Riprova'}
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}

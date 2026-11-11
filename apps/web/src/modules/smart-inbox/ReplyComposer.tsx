import { useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Button } from '@homisuite/ui'
import { BookOpenText, CircleAlert, ClipboardCheck, Copy, FileText, Languages, PenLine, Send, Wand2 } from 'lucide-react'
import { useReadsLanguage } from './agentContext'
import { refineDraft, saveDraftBody, sendReply, SmartInboxActionError } from './api'
import {
  ACTION_LABELS,
  actionErrorLabel,
  appendSignature,
  deliveryOf,
  fillTemplate,
  insertTemplateText,
  languageName,
  QUICK_REFINEMENTS,
  SOURCE_LABELS,
} from './labels'
import type { InboxDraft, InboxMessage, ReplyTemplate, SignAs, SignatureInfo } from './types'

function readableError(cause: unknown): string {
  return actionErrorLabel(cause instanceof SmartInboxActionError ? cause.code : null)
}

// Clipboard API first; the textarea trick for browsers/contexts without it.
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    area.remove()
    return ok
  }
}

// The reply being prepared for one guest message, wherever it shows up
// (Posta or Componi risposta): editable text, the sender's signature under
// it, what the assistant used, what's missing, quick rewrites, and the one
// button that finishes the job (send from Outlook, or copy for a channel
// that isn't connected).
export function ReplyComposer({ client, message, draft, guestName, templates, signature, showTranslation, showSources = true, onChanged, onSent }: {
  client: SupabaseClient
  message: InboxMessage
  draft: InboxDraft
  guestName: string
  templates: ReplyTemplate[]
  signature: SignatureInfo | null
  showTranslation: boolean
  // Templates/information used, as chips (Componi risposta lists them in
  // its own column).
  showSources?: boolean
  onChanged: () => Promise<void>
  onSent: (result: { copied: boolean; channel: string }) => Promise<void> | void
}) {
  const [body, setBody] = useState(draft.body)
  const [signAs, setSignAs] = useState<SignAs>('agent')
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState<null | 'send' | 'save' | 'refine' | 'copy'>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Last caret position the person left in the draft; null until they
  // click or type in it (then templates go where they were working).
  const cursorRef = useRef<{ start: number; end: number } | null>(null)
  const dirty = body !== draft.body
  // Pasted in Componi risposta: nothing is sent, staff copy the reply.
  const pasted = deliveryOf(message) === 'pasted'
  const readsLanguage = useReadsLanguage()

  // A regenerated or revised draft arrives through a reload: adopt it
  // unless the person had edited the previous one (a revision they asked
  // for is always adopted: their edits were its starting point).
  const lastDraftBody = useRef(draft.body)
  const adoptNext = useRef(false)
  useEffect(() => {
    if (adoptNext.current || body === lastDraftBody.current) setBody(draft.body)
    adoptNext.current = false
    lastDraftBody.current = draft.body
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.body])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const signatureText = signature ? (signAs === 'property' && signature.property ? signature.property : signature.agent) : ''
  const finalText = appendSignature(body, signatureText)
  const translationCurrent = body.trim() === draft.ai_body.trim()

  async function run(kind: NonNullable<typeof busy>, action: () => Promise<void>) {
    setBusy(kind)
    setError(null)
    setNotice(null)
    try {
      await action()
    } catch (cause) {
      setError(readableError(cause))
    } finally {
      setBusy(null)
    }
  }

  function insertTemplate(templateId: string) {
    const template = templates.find((item) => item.id === templateId)
    if (!template) return
    const language = message.language?.toLowerCase().slice(0, 2) ?? 'it'
    const text = fillTemplate(template.translations?.[language]?.trim() || template.body, guestName)
    const { value, caret } = insertTemplateText(body, text, cursorRef.current)
    setBody(value)
    cursorRef.current = { start: caret, end: caret }
    const area = textareaRef.current
    if (!area) return
    requestAnimationFrame(() => {
      area.focus()
      area.setSelectionRange(caret, caret)
    })
  }

  function refine(text: string) {
    void run('refine', async () => {
      await refineDraft(client, draft.id, text, body)
      setInstruction('')
      adoptNext.current = true
      await onChanged()
      setNotice('Risposta riscritta.')
    })
  }

  // Pasted channel: mark it answered and put the signed text on the
  // clipboard, ready to paste in Booking/WhatsApp. Outlook: send it.
  function finish() {
    void run('send', async () => {
      const result = await sendReply(client, draft.id, body, signAs)
      const copied = pasted ? await copyText(result.text) : false
      await onSent({ copied, channel: result.channel })
    })
  }

  const language = languageName(message.language)
  const usedTemplates = draft.templates_used ?? []
  const usedInfo = draft.info_used ?? []
  const missing = draft.missing_fields ?? []

  return (
    <div className="smart-inbox-composer">
      <div className="smart-inbox-draft-head">
        <h3>Risposta pronta{language ? <span className="smart-inbox-lang"> · {language}</span> : null}</h3>
        {templates.length > 0 ? (
          <label className="smart-inbox-template-picker">
            <FileText size={14} aria-hidden="true" />
            <span className="sr-only">Inserisci un modello</span>
            <select value="" onChange={(event) => insertTemplate(event.target.value)}>
              <option value="">Inserisci modello…</option>
              {templates.map((template) => <option key={template.id} value={template.id}>{template.title}</option>)}
            </select>
          </label>
        ) : null}
      </div>

      {showSources && (usedTemplates.length > 0 || usedInfo.length > 0) ? (
        <p className="smart-inbox-used">
          {usedTemplates.map((title) => <span key={`t-${title}`} className="smart-inbox-chip template"><FileText size={12} aria-hidden="true" /> {title}</span>)}
          {usedInfo.map((title) => <span key={`i-${title}`} className="smart-inbox-chip info"><BookOpenText size={12} aria-hidden="true" /> {title}</span>)}
        </p>
      ) : null}

      <label className="form-field smart-inbox-draft">
        <span className="sr-only">Testo della risposta</span>
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onSelect={(event) => { cursorRef.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd } }}
          rows={12}
          maxLength={20000}
          readOnly={busy === 'refine'}
          aria-busy={busy === 'refine'}
        />
      </label>

      {signature ? (
        <div className="smart-inbox-signature" aria-label="Firma">
          <div className="smart-inbox-signature-text">{signatureText}</div>
          {signature.property ? (
            <label className="smart-inbox-sign-as">
              <PenLine size={13} aria-hidden="true" />
              <span>Firma come</span>
              <select value={signAs} onChange={(event) => setSignAs(event.target.value as SignAs)}>
                <option value="agent">{signature.name ? `${signature.name} (tu)` : 'Tu'}</option>
                <option value="property">{signature.property.split('\n')[0]} (senza nome)</option>
              </select>
            </label>
          ) : null}
        </div>
      ) : null}

      {showTranslation && draft.translation && !readsLanguage(message.language) ? (
        <details className="smart-inbox-translation" open>
          <summary><Languages size={14} aria-hidden="true" /> Traduzione per te (italiano){translationCurrent ? '' : ' · della bozza originale'}</summary>
          <p>{draft.translation}</p>
        </details>
      ) : null}

      <div className="smart-inbox-refine" role="group" aria-label="Modifica con l'assistente">
        {QUICK_REFINEMENTS.map((item) => (
          <button key={item.label} type="button" className="smart-inbox-filter-chip" disabled={busy !== null || !body.trim()} onClick={() => refine(item.instruction)}>
            <Wand2 size={13} aria-hidden="true" /> {item.label}
          </button>
        ))}
        <form
          className="smart-inbox-refine-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (instruction.trim()) refine(instruction.trim())
          }}
        >
          <input
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            maxLength={1000}
            placeholder="Chiedi una modifica… es. aggiungi gli orari della colazione"
            aria-label="Istruzione per l'assistente"
            disabled={busy !== null}
          />
          <Button variant="secondary" type="submit" disabled={busy !== null || !instruction.trim() || !body.trim()}>
            {busy === 'refine' ? 'Riscrivo…' : 'Applica'}
          </Button>
        </form>
      </div>

      {missing.length > 0 ? (
        <p className="smart-inbox-missing" role="note">
          <CircleAlert size={14} aria-hidden="true" />
          {missing.length === 1 ? 'Manca 1 dato' : `Mancano ${missing.length} dati`}: {missing.join(', ')}. Controlla che la risposta lo chieda all'ospite o completalo tu.
        </p>
      ) : null}

      {draft.suggested_actions.length > 0 ? (
        <div className="smart-inbox-actions-box">
          <h3>Da organizzare</h3>
          <ul>
            {draft.suggested_actions.map((action, index) => (
              <li key={index}><strong>{ACTION_LABELS[action.type]}:</strong> {action.details}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {notice ? <p className="smart-inbox-notice" role="status">{notice}</p> : null}

      <div className="smart-inbox-buttons">
        {pasted ? (
          <>
            <Button variant="primary" onClick={finish} disabled={busy !== null || !body.trim()}>
              <ClipboardCheck size={15} /> {busy === 'send' ? 'Un attimo…' : 'Copia e segna come risposto'}
            </Button>
            <Button
              variant="secondary"
              disabled={busy !== null || !body.trim()}
              onClick={() => void run('copy', async () => {
                setNotice(await copyText(finalText) ? 'Copiata: incollala in ' + SOURCE_LABELS[message.source] + '.' : 'Copia non riuscita: seleziona il testo e copialo a mano.')
              })}
            >
              <Copy size={15} /> Copia
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={finish} disabled={busy !== null || !body.trim()}>
            <Send size={15} /> {busy === 'send' ? 'Invio…' : message.whatsapp_account_id ? 'Invia su WhatsApp' : 'Invia risposta'}
          </Button>
        )}
        {dirty && body.trim() ? (
          <Button
            variant="secondary"
            onClick={() => void run('save', async () => {
              await saveDraftBody(client, draft.id, body)
              await onChanged()
              setNotice('Bozza salvata.')
            })}
            disabled={busy !== null}
          >
            {busy === 'save' ? 'Salvataggio…' : 'Salva bozza'}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

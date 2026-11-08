import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Button } from '@homisuite/ui'
import { Copy, FileText, Lightbulb, Plus, Search } from 'lucide-react'
import { PageState } from '../../components/PageState'
import { useConfirm } from '../../components/ConfirmDialog'
import { createTemplate, deleteTemplate, listKnowledge, listTemplates, loadGaps, loadTemplateUsage, updateTemplate } from './api'
import { LANGUAGE_LABELS, previewTemplate, TEMPLATE_CATEGORY_LABELS, TEMPLATE_FIELDS, templateLanguages } from './labels'
import type { KnowledgeEntry, ReplyTemplate, TemplateCategory } from './types'

type Draft = Pick<ReplyTemplate, 'title' | 'body' | 'category' | 'when_to_use' | 'translations'>

const EMPTY: Draft = { title: '', body: '', category: 'prima_arrivo', when_to_use: '', translations: {} }
const CATEGORIES = Object.keys(TEMPLATE_CATEGORY_LABELS) as TemplateCategory[]

function toDraft(template: ReplyTemplate): Draft {
  return { title: template.title, body: template.body, category: template.category, when_to_use: template.when_to_use, translations: { ...template.translations } }
}

// Approved answers. Staff insert them with one click; the assistant reads
// "quando usarlo" to pick them, fills the fields from the guest's message
// and uses the version in the guest's language (or translates the Italian).
export function TemplatesTab({ client, propertyId, canManage }: { client: SupabaseClient; propertyId: string; canManage: boolean }) {
  const [templates, setTemplates] = useState<ReplyTemplate[] | null>(null)
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>([])
  const [usage, setUsage] = useState<Map<string, number>>(new Map())
  const [gaps, setGaps] = useState<Array<{ topic: string; count: number }>>([])
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | 'new' | null>(null)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [language, setLanguage] = useState('it')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [confirmDialog, confirm] = useConfirm()
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const cursorRef = useRef<{ start: number; end: number } | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const [next, info, used, found] = await Promise.all([
        listTemplates(client, propertyId),
        listKnowledge(client, propertyId),
        loadTemplateUsage(client, propertyId).catch(() => new Map<string, number>()),
        loadGaps(client, propertyId).catch(() => ({ missingInfo: [], templateGaps: [] })),
      ])
      setTemplates(next)
      setKnowledge(info)
      setUsage(used)
      setGaps(found.templateGaps)
      return next
    } catch (cause) {
      console.error('Smart Inbox: templates not loaded', cause)
      setError('Impossibile caricare i modelli. Riprova.')
      setTemplates((current) => current ?? [])
      return null
    }
  }, [client, propertyId])

  useEffect(() => { void load() }, [load])

  const selected = templates?.find((template) => template.id === selectedId) ?? null

  function select(id: string | 'new', initial?: Partial<Draft>) {
    setSelectedId(id)
    const template = templates?.find((item) => item.id === id)
    setDraft(template ? toDraft(template) : { ...EMPTY, ...initial })
    setLanguage('it')
    setSaved(false)
    setError(null)
    cursorRef.current = null
  }

  // Open the first template so the screen never starts empty.
  useEffect(() => {
    if (templates && templates.length > 0 && selectedId === null) select(templates[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates])

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const visible = (templates ?? []).filter((template) => !needle
      || template.title.toLowerCase().includes(needle)
      || template.body.toLowerCase().includes(needle)
      || template.when_to_use.toLowerCase().includes(needle))
    return CATEGORIES
      .map((category) => ({ category, items: visible.filter((template) => template.category === category) }))
      .filter((group) => group.items.length > 0)
  }, [templates, query])

  const text = language === 'it' ? draft.body : draft.translations[language] ?? ''
  const languages = ['it', ...Object.keys(draft.translations).filter((code) => code !== 'it')]
  const missingLanguages = Object.keys(LANGUAGE_LABELS).filter((code) => !languages.includes(code))
  const dirty = selectedId === 'new' || (selected ? JSON.stringify(toDraft(selected)) !== JSON.stringify(draft) : false)

  function setText(value: string) {
    if (language === 'it') setDraft({ ...draft, body: value })
    else setDraft({ ...draft, translations: { ...draft.translations, [language]: value } })
    setSaved(false)
  }

  // Fields go inline at the cursor (end of the text if the person hasn't
  // clicked in it yet), with a space on either side when needed.
  function insertField(field: string) {
    const cursor = cursorRef.current ?? { start: text.length, end: text.length }
    const before = text.slice(0, cursor.start)
    const after = text.slice(cursor.end)
    const lead = before && !/\s$/.test(before) ? ' ' : ''
    const trail = after && !/^[\s,.;:!?]/.test(after) ? ' ' : ''
    setText(`${before}${lead}${field}${trail}${after}`)
    const position = before.length + lead.length + field.length
    cursorRef.current = { start: position, end: position }
    requestAnimationFrame(() => {
      bodyRef.current?.focus()
      bodyRef.current?.setSelectionRange(position, position)
    })
  }

  async function save() {
    const title = draft.title.trim()
    const body = draft.body.trim()
    if (!title || !body) {
      setError('Nome e testo in italiano sono obbligatori.')
      return
    }
    const translations = Object.fromEntries(Object.entries(draft.translations).map(([code, value]) => [code, value.trim()]).filter(([, value]) => value))
    const values = { ...draft, title, body, when_to_use: draft.when_to_use.trim(), translations }
    setSaving(true)
    setError(null)
    try {
      if (selectedId && selectedId !== 'new') {
        await updateTemplate(client, selectedId, values)
        await load()
        setDraft(values)
      } else {
        await createTemplate(client, propertyId, { ...values, sort_order: templates?.length ?? 0 })
        const next = await load()
        const created = next?.find((template) => template.title === title && template.body === body)
        if (created) {
          setSelectedId(created.id)
          setDraft(toDraft(created))
        }
      }
      setSaved(true)
    } catch {
      setError('Salvataggio non riuscito. Riprova.')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!selected) return
    const confirmed = await confirm({
      title: 'Eliminare questo modello?',
      description: `"${selected.title}" non sarà più usato nelle risposte.`,
      confirmLabel: 'Elimina',
    })
    if (!confirmed) return
    try {
      await deleteTemplate(client, selected.id)
      setSelectedId(null)
      await load()
    } catch {
      setError('Eliminazione non riuscita. Riprova.')
    }
  }

  if (!templates) return <PageState kind="loading" title="Caricamento modelli…" />

  const editing = selectedId !== null
  const readOnly = !canManage

  return (
    <div className="page-stack">
      {canManage && gaps.length > 0 ? (
        <section className="shell-card smart-inbox-suggestion">
          <Lightbulb size={18} aria-hidden="true" />
          <div>
            <strong>Suggerimento dell'assistente</strong>
            <p>
              Negli ultimi due mesi avete risposto {gaps[0].count === 1 ? 'una volta' : `${gaps[0].count} volte`} su “{gaps[0].topic}” senza un modello.
              {gaps.length > 1 ? ` Anche: ${gaps.slice(1, 3).map((gap) => gap.topic).join(', ')}.` : ''}
            </p>
          </div>
          <Button variant="secondary" onClick={() => select('new', { title: gaps[0].topic, when_to_use: `Quando l'ospite chiede: ${gaps[0].topic.toLowerCase()}` })}>Crea modello</Button>
        </section>
      ) : null}

      <div className={`smart-inbox-library${editing ? ' has-selection' : ''}`}>
        <section className="shell-card smart-inbox-library-list" aria-label="Modelli">
          <div className="smart-inbox-library-head">
            <strong>{templates.length === 1 ? '1 modello' : `${templates.length} modelli`}</strong>
            {canManage ? <button className="secondary-action" type="button" onClick={() => select('new')}><Plus size={16} /> Nuovo</button> : null}
          </div>
          <label className="smart-inbox-search">
            <Search size={14} aria-hidden="true" />
            <span className="sr-only">Cerca un modello</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca un modello" />
          </label>
          {templates.length === 0 ? (
            <PageState
              kind="empty"
              icon={FileText}
              title="Nessun modello ancora."
              description="Ad esempio: check-in tardivo, conferma prenotazione, come arrivare, politica di cancellazione."
            />
          ) : groups.length === 0 ? (
            <p className="muted smart-inbox-note smart-inbox-pad">Nessun modello trovato.</p>
          ) : (
            groups.map((group) => (
              <div key={group.category} className="smart-inbox-library-group">
                <h3>{TEMPLATE_CATEGORY_LABELS[group.category]}</h3>
                <ul>
                  {group.items.map((template) => (
                    <li key={template.id}>
                      <button
                        type="button"
                        className={`smart-inbox-library-item${template.id === selectedId ? ' selected' : ''}`}
                        aria-current={template.id === selectedId ? 'true' : undefined}
                        onClick={() => select(template.id)}
                      >
                        <span>{template.title}</span>
                        <small>{templateLanguages(template.translations).join(' · ')}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>

        {editing ? (
          <section className="shell-card smart-inbox-library-editor" aria-label="Modello">
            <button className="secondary-action smart-inbox-back" type="button" onClick={() => setSelectedId(null)}>Modelli</button>
            <div className="smart-inbox-editor-head">
              <input
                className="smart-inbox-title-input"
                value={draft.title}
                onChange={(event) => { setDraft({ ...draft, title: event.target.value }); setSaved(false) }}
                maxLength={120}
                placeholder="Nome del modello, es. Check-in tardivo"
                aria-label="Nome del modello"
                readOnly={readOnly}
              />
              {selected ? (
                <p className="muted">
                  {usage.get(selected.title) ? `Usato ${usage.get(selected.title)} ${usage.get(selected.title) === 1 ? 'volta' : 'volte'} questo mese · ` : ''}
                  ultima modifica {new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' }).format(new Date(selected.updated_at))}
                </p>
              ) : null}
            </div>

            <div className="smart-inbox-editor-row">
              <label className="form-field">
                <span>Categoria</span>
                <select value={draft.category} onChange={(event) => { setDraft({ ...draft, category: event.target.value as TemplateCategory }); setSaved(false) }} disabled={readOnly}>
                  {CATEGORIES.map((category) => <option key={category} value={category}>{TEMPLATE_CATEGORY_LABELS[category]}</option>)}
                </select>
              </label>
              <label className="form-field smart-inbox-grow">
                <span>Quando usarlo</span>
                <input
                  value={draft.when_to_use}
                  onChange={(event) => { setDraft({ ...draft, when_to_use: event.target.value }); setSaved(false) }}
                  maxLength={500}
                  placeholder="Es. l'ospite arriva dopo le 22 o chiede se può fare il check-in tardi"
                  readOnly={readOnly}
                />
                <small>L'assistente legge questa frase per capire quando usarlo.</small>
              </label>
            </div>

            <div className="form-field">
              <span>Testo</span>
              <div className="smart-inbox-lang-tabs" role="tablist" aria-label="Lingua del testo">
                {languages.map((code) => (
                  <button key={code} type="button" role="tab" aria-selected={language === code} className={language === code ? 'active' : ''} onClick={() => setLanguage(code)}>
                    {LANGUAGE_LABELS[code] ?? code.toUpperCase()}
                  </button>
                ))}
                {canManage && missingLanguages.length > 0 ? (
                  <label className="smart-inbox-add-lang">
                    <span className="sr-only">Aggiungi una lingua</span>
                    <select
                      value=""
                      onChange={(event) => {
                        const code = event.target.value
                        if (!code) return
                        setDraft({ ...draft, translations: { ...draft.translations, [code]: '' } })
                        setLanguage(code)
                      }}
                    >
                      <option value="">+ Lingua</option>
                      {missingLanguages.filter((code) => code !== 'it').map((code) => <option key={code} value={code}>{LANGUAGE_LABELS[code]}</option>)}
                    </select>
                  </label>
                ) : null}
              </div>
              <textarea
                ref={bodyRef}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onSelect={(event) => { cursorRef.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd } }}
                rows={9}
                maxLength={8000}
                placeholder={language === 'it' ? 'Gentile {nome},\nnessun problema per l\'arrivo del {data arrivo} verso le {ora arrivo}: la reception è aperta 24 ore su 24.' : 'Lascia vuoto per far tradurre all\'assistente il testo italiano.'}
                aria-label={`Testo in ${LANGUAGE_LABELS[language] ?? language}`}
                readOnly={readOnly}
              />
              {canManage ? (
                <div className="smart-inbox-fields">
                  <span className="muted">Inserisci:</span>
                  {TEMPLATE_FIELDS.map((field) => (
                    <button key={field} type="button" className="smart-inbox-chip field" onClick={() => insertField(field)}>{field.slice(1, -1)}</button>
                  ))}
                  {knowledge.length > 0 ? (
                    <label className="smart-inbox-chip info smart-inbox-info-pick">
                      <span className="sr-only">Inserisci un'informazione hotel</span>
                      <select value="" onChange={(event) => { if (event.target.value) insertField(`{info: ${event.target.value}}`) }}>
                        <option value="">un'informazione hotel…</option>
                        {knowledge.map((entry) => <option key={entry.id} value={entry.title}>{entry.title}</option>)}
                      </select>
                    </label>
                  ) : null}
                </div>
              ) : null}
              <small>I dati dell'ospite li riempie l'assistente dal messaggio; se un dato manca, la frase si adatta o viene chiesto all'ospite. Le informazioni hotel sono sempre quelle aggiornate.</small>
            </div>

            {text.trim() ? (
              <div className="smart-inbox-preview">
                <h3>Anteprima · ospite di esempio: Lukas, 14 dicembre, 23:00</h3>
                <p>{previewTemplate(text, knowledge)}</p>
              </div>
            ) : null}

            {error ? <p className="form-error" role="alert">{error}</p> : null}
            {canManage ? (
              <div className="smart-inbox-buttons">
                <Button variant="primary" onClick={() => void save()} disabled={saving || !dirty}>{saving ? 'Salvataggio…' : 'Salva'}</Button>
                {selected ? (
                  <Button variant="secondary" onClick={() => select('new', { ...toDraft(selected), title: `${selected.title} (copia)` })} disabled={saving}>
                    <Copy size={15} /> Duplica
                  </Button>
                ) : null}
                {selected ? <Button variant="danger" onClick={() => void remove()} disabled={saving}>Elimina</Button> : null}
                {selectedId === 'new' ? <Button variant="secondary" onClick={() => setSelectedId(null)} disabled={saving}>Annulla</Button> : null}
                {saved && !dirty ? <span className="smart-inbox-notice" role="status">Salvato.</span> : null}
              </div>
            ) : <p className="muted smart-inbox-note">Solo un responsabile può modificare i modelli.</p>}
          </section>
        ) : (
          <section className="shell-card smart-inbox-library-editor smart-inbox-detail-empty">
            <PageState kind="empty" icon={FileText} title="Seleziona un modello" description={canManage ? 'Oppure creane uno nuovo.' : undefined} />
          </section>
        )}
      </div>
      {confirmDialog}
    </div>
  )
}

import { useMemo, useState } from 'react'
import { CalendarDays, ChevronDown, Eye, Settings2, ShieldCheck, UsersRound } from 'lucide-react'
import { shiftPreviewProperties, type ShiftPreviewProperty } from '../preview/fixtures'
import { ConfigurationPanel } from './ConfigurationPanel'
import { ScheduleGrid } from './ScheduleGrid'

export interface ShiftPlannerCapabilities {
  view: boolean
  manage: boolean
  manageRequests: boolean
}

export interface ShiftPlannerModuleProps {
  preview?: boolean
  initialPropertyId?: string
  capabilities?: ShiftPlannerCapabilities
  previewProperties?: ShiftPreviewProperty[]
}

type ModuleTab = 'schedule' | 'configuration'

const DEFAULT_CAPABILITIES: ShiftPlannerCapabilities = {
  view: true,
  manage: true,
  manageRequests: true,
}

export function ShiftPlannerModule({
  preview = false,
  initialPropertyId,
  capabilities = DEFAULT_CAPABILITIES,
  previewProperties = shiftPreviewProperties,
}: ShiftPlannerModuleProps) {
  const initialProperty = previewProperties.find((property) => property.id === initialPropertyId) ?? previewProperties[0]
  const [propertyId, setPropertyId] = useState(initialProperty?.id ?? '')
  const [unitId, setUnitId] = useState(initialProperty?.units[0]?.id ?? '')
  const [tab, setTab] = useState<ModuleTab>('schedule')
  const [readOnlyDemo, setReadOnlyDemo] = useState(false)

  const property = useMemo(
    () => previewProperties.find((candidate) => candidate.id === propertyId) ?? previewProperties[0],
    [previewProperties, propertyId],
  )
  const unit = property?.units.find((candidate) => candidate.id === unitId) ?? property?.units[0]
  const readOnly = readOnlyDemo || !capabilities.manage

  function changeProperty(nextPropertyId: string) {
    const nextProperty = previewProperties.find((candidate) => candidate.id === nextPropertyId)
    setPropertyId(nextPropertyId)
    setUnitId(nextProperty?.units[0]?.id ?? '')
  }

  function togglePreviewRole() {
    setReadOnlyDemo((current) => {
      const next = !current
      if (next) setTab('schedule')
      return next
    })
  }

  if (!capabilities.view || !property || !unit) {
    return <div className="shift-root"><div className="shift-empty">Turni non è disponibile per questa struttura.</div></div>
  }

  return (
    <div className="shift-root">
      {preview ? (
        <div className="shift-preview-banner" role="status">
          <Eye size={16} />
          <span><strong>Anteprima interattiva</strong> · dati fittizi, nessuna modifica viene salvata</span>
        </div>
      ) : null}

      <header className="shift-header">
        <div>
          <p className="shift-eyebrow">{property.name}</p>
          <h1>Turni</h1>
          <p>Una tabella per ogni unità operativa, con persone e regole indipendenti.</p>
        </div>
        {preview ? (
          <label className="shift-field shift-property-field">
            <span>Scenario</span>
            <span className="shift-select-wrap">
              <select value={property.id} onChange={(event) => changeProperty(event.target.value)}>
                {previewProperties.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}
              </select>
              <ChevronDown size={16} aria-hidden="true" />
            </span>
          </label>
        ) : null}
      </header>

      <div className="shift-unit-bar" aria-label="Unità di pianificazione">
        <div className="shift-unit-tabs" role="tablist">
          {property.units.map((candidate) => (
            <button
              type="button"
              role="tab"
              aria-selected={candidate.id === unit.id}
              className={candidate.id === unit.id ? 'is-active' : undefined}
              onClick={() => setUnitId(candidate.id)}
              key={candidate.id}
            >
              {candidate.name}
              <span>{candidate.people.length}</span>
            </button>
          ))}
        </div>
        {preview ? (
          <button className="shift-view-toggle" type="button" onClick={togglePreviewRole}>
            {readOnly ? <Eye size={15} /> : <ShieldCheck size={15} />}
            Vista {readOnly ? 'dipendente' : 'responsabile'}
          </button>
        ) : null}
      </div>

      <div className="shift-toolbar">
        <div className="shift-section-tabs" role="tablist" aria-label="Sezioni Turni">
          <button type="button" role="tab" aria-selected={tab === 'schedule'} className={tab === 'schedule' ? 'is-active' : undefined} onClick={() => setTab('schedule')}>
            <CalendarDays size={16} /> Calendario
          </button>
          {!readOnly ? (
            <button type="button" role="tab" aria-selected={tab === 'configuration'} className={tab === 'configuration' ? 'is-active' : undefined} onClick={() => setTab('configuration')}>
              <Settings2 size={16} /> Configurazione
            </button>
          ) : null}
        </div>
        <div className="shift-month-copy">
          <span>19–25 ottobre 2026</span>
          <span className="shift-status-chip">Bozza</span>
        </div>
      </div>

      {tab === 'schedule' ? (
        <>
          <section className="shift-summary-row" aria-label="Riepilogo unità">
            <article><UsersRound size={18} /><span><strong>{unit.people.length}</strong> persone</span></article>
            <article><CalendarDays size={18} /><span><strong>{unit.codes.filter((code) => code.time).length}</strong> turni lavorati</span></article>
            <article><ShieldCheck size={18} /><span><strong>v{unit.ruleSetVersion}</strong> {unit.ruleSetName}</span></article>
          </section>
          <section className="shift-schedule-card">
            <div className="shift-card-heading">
              <div><h2>{unit.name}</h2><p>Settimana operativa · la griglia e i colori restano quelli familiari.</p></div>
              <div className="shift-coverage-list" aria-label="Copertura richiesta">
                {unit.rules.coverage.map((item) => <span key={item}>{item}</span>)}
              </div>
            </div>
            <ScheduleGrid unit={unit} />
            <div className="shift-legend">
              {unit.codes.map((code) => (
                <span key={code.code}><i style={{ background: code.color }} /> <strong>{code.code}</strong> {code.label}</span>
              ))}
            </div>
          </section>
        </>
      ) : <ConfigurationPanel unit={unit} />}
    </div>
  )
}

import { BadgeCheck, BriefcaseBusiness, ShieldCheck, Sparkles, UserRoundCheck, UserRoundX } from 'lucide-react'
import type { ShiftPlanningUnit } from '../preview/fixtures'

interface ConfigurationPanelProps {
  unit: ShiftPlanningUnit
}

export function ConfigurationPanel({ unit }: ConfigurationPanelProps) {
  return (
    <div className="shift-config-grid">
      <section className="shift-panel">
        <div className="shift-panel-heading">
          <span className="shift-panel-icon"><BriefcaseBusiness size={18} /></span>
          <div>
            <h2>Mansioni incluse</h2>
            <p>Il team si aggiorna dai profili Core della struttura.</p>
          </div>
        </div>
        <div className="shift-job-list">
          {unit.jobTitles.map((title) => (
            <div className="shift-job-row" key={title}>
              <UserRoundCheck size={17} />
              <span>{title}</span>
              <span className="shift-status-chip is-on">Inclusa</span>
            </div>
          ))}
          {unit.excludedJobTitles.map((title) => (
            <div className="shift-job-row is-muted" key={title}>
              <UserRoundX size={17} />
              <span>{title}</span>
              <span className="shift-status-chip">Esclusa</span>
            </div>
          ))}
        </div>
        <p className="shift-panel-note">Le eccezioni individuali non cambiano la mansione registrata in Team.</p>
      </section>

      <section className="shift-panel">
        <div className="shift-panel-heading">
          <span className="shift-panel-icon"><BadgeCheck size={18} /></span>
          <div>
            <h2>Ruleset attivo</h2>
            <p>{unit.ruleSetName} · versione {unit.ruleSetVersion}</p>
          </div>
        </div>
        <div className="shift-rule-group">
          <h3><ShieldCheck size={15} /> Vincoli rigidi</h3>
          <ul>{unit.rules.hard.map((rule) => <li key={rule}>{rule}</li>)}</ul>
        </div>
        <div className="shift-rule-group">
          <h3><Sparkles size={15} /> Preferenze ordinate</h3>
          <ol>{unit.rules.soft.map((rule) => <li key={rule}>{rule}</li>)}</ol>
        </div>
      </section>

      <section className="shift-panel shift-panel-wide">
        <div className="shift-panel-heading">
          <span className="shift-panel-icon"><UserRoundCheck size={18} /></span>
          <div>
            <h2>Persone dell’unità</h2>
            <p>{unit.people.length} persone incluse, automaticamente o come eccezione.</p>
          </div>
        </div>
        <div className="shift-roster-preview">
          {unit.people.map((person) => (
            <article key={person.id}>
              <span className="shift-avatar" aria-hidden="true">{person.initials}</span>
              <span><strong>{person.name}</strong><small>{person.jobTitle}</small></span>
              <span className="shift-assignment-profile">{person.assignmentProfile}</span>
              <span className="shift-source">{person.includedBy === 'manual' ? 'Eccezione manuale' : 'Dalla mansione'}</span>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

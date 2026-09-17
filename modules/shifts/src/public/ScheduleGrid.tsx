import { LockKeyhole } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { ShiftPlanningUnit } from '../preview/fixtures'

const DAYS = [
  { weekday: 'Lun', day: '19' },
  { weekday: 'Mar', day: '20' },
  { weekday: 'Mer', day: '21' },
  { weekday: 'Gio', day: '22' },
  { weekday: 'Ven', day: '23' },
  { weekday: 'Sab', day: '24', weekend: true },
  { weekday: 'Dom', day: '25', weekend: true },
]

interface ScheduleGridProps {
  unit: ShiftPlanningUnit
}

export function ScheduleGrid({ unit }: ScheduleGridProps) {
  const codeMap = new Map(unit.codes.map((code) => [code.code, code]))

  return (
    <div className="shift-grid-scroll" tabIndex={0} aria-label={`Tabella turni ${unit.name}`}>
      <table className="shift-grid">
        <thead>
          <tr>
            <th className="shift-person-column">Persona</th>
            {DAYS.map((day) => (
              <th className={day.weekend ? 'is-weekend' : undefined} key={day.day}>
                <span>{day.weekday}</span>
                <strong>{day.day}</strong>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {unit.people.map((person) => (
            <tr key={person.id}>
              <th scope="row" className="shift-person-column">
                <span className="shift-avatar" aria-hidden="true">{person.initials}</span>
                <span className="shift-person-copy">
                  <strong>{person.name}</strong>
                  <small>{person.assignmentProfile}</small>
                </span>
              </th>
              {(unit.assignments[person.id] ?? []).map((code, index) => {
                const definition = codeMap.get(code)
                return (
                  <td key={`${person.id}-${DAYS[index]?.day ?? index}`}>
                    <div
                      className="shift-cell"
                      aria-label={`${person.name}, ${DAYS[index]?.weekday} ${DAYS[index]?.day}: ${definition?.label ?? code}`}
                      title={`${definition?.label ?? code}${definition?.time ? ` · ${definition.time}` : ''}`}
                      style={{
                        '--shift-color': definition?.color ?? '#9AA0A6',
                        '--shift-text': definition?.textColor ?? '#fff',
                      } as CSSProperties}
                    >
                      <strong>{code}</strong>
                      {definition?.time ? <small>{definition.time}</small> : null}
                      {person.id === 'hamza' && index === 1 ? <LockKeyhole size={10} aria-label="Bloccato" /> : null}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

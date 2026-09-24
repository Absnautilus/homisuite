export interface ShiftCode {
  code: string
  label: string
  time: string
  color: string
  textColor?: string
}

export interface ShiftPerson {
  id: string
  name: string
  initials: string
  jobTitle: string
  assignmentProfile: string
  includedBy: 'job-title' | 'manual'
  restMode: 'fixed' | 'rotating'
  restDays?: string
}

export interface ShiftRuleSummary {
  hard: string[]
  soft: string[]
  coverage: string[]
}

export interface ShiftPlanningUnit {
  id: string
  name: string
  jobTitles: string[]
  excludedJobTitles: string[]
  ruleSetName: string
  ruleSetVersion: number
  ruleSetEngineVersion?: string
  codes: ShiftCode[]
  people: ShiftPerson[]
  assignments: Record<string, string[]>
  assignmentDates?: string[]
  lockedAssignments?: Record<string, string[]>
  month?: string
  monthStatus?: 'draft' | 'final'
  rules: ShiftRuleSummary
}

export interface ShiftPreviewProperty {
  id: string
  name: string
  units: ShiftPlanningUnit[]
}

const receptionCodes: ShiftCode[] = [
  { code: 'A1', label: 'Apertura 1', time: '07:00–15:00', color: '#3FA935' },
  { code: 'A2', label: 'Apertura 2', time: '08:30–16:30', color: '#9C4FC7' },
  { code: 'CE', label: 'Centrale', time: '09:30–17:30', color: '#E8541E' },
  { code: 'C1', label: 'Chiusura 1', time: '14:00–22:00', color: '#F5A623', textColor: '#282014' },
  { code: 'C2', label: 'Chiusura 2', time: '15:00–23:00', color: '#EAD23C', textColor: '#282014' },
  { code: 'N', label: 'Notte', time: '23:00–07:00', color: '#E63946' },
  { code: 'R', label: 'Riposo', time: '', color: '#9AA0A6' },
  { code: 'F', label: 'Ferie', time: '', color: '#C9A227', textColor: '#282014' },
]

export const shiftPreviewProperties: ShiftPreviewProperty[] = [
  {
    id: 'palazzo-veneziano',
    name: 'Palazzo Veneziano',
    units: [
      {
        id: 'pv-reception',
        name: 'Reception',
        jobTitles: ['Receptionist', 'Front Office Manager', 'Rooms Division Manager'],
        excludedJobTitles: ['Facchino', 'Governante'],
        ruleSetName: 'Palazzo Veneziano · Reception',
        ruleSetVersion: 1,
        codes: receptionCodes,
        people: [
          { id: 'ana', name: 'Ana Beatrice', initials: 'AB', jobTitle: 'Receptionist', assignmentProfile: 'Diurno', includedBy: 'job-title', restMode: 'rotating' },
          { id: 'hamza', name: 'Hamza', initials: 'HA', jobTitle: 'Receptionist', assignmentProfile: 'Turnante', includedBy: 'job-title', restMode: 'rotating' },
          { id: 'farouk', name: 'Farouk', initials: 'FA', jobTitle: 'Receptionist', assignmentProfile: 'Notturno', includedBy: 'job-title', restMode: 'rotating' },
          { id: 'giulia', name: 'Giulia', initials: 'GI', jobTitle: 'Receptionist', assignmentProfile: 'Diurno', includedBy: 'job-title', restMode: 'rotating' },
          { id: 'marta', name: 'Marta', initials: 'MA', jobTitle: 'Front Office Manager', assignmentProfile: 'FOM', includedBy: 'job-title', restMode: 'fixed', restDays: 'Dom + Lun' },
          { id: 'luca', name: 'Luca', initials: 'LU', jobTitle: 'Receptionist', assignmentProfile: 'Turnante', includedBy: 'manual', restMode: 'fixed', restDays: 'Sab + Dom' },
        ],
        assignments: {
          ana: ['A1', 'A1', 'R', 'R', 'C1', 'C1', 'CE'],
          hamza: ['C2', 'C2', 'A2', 'A2', 'R', 'R', 'N'],
          farouk: ['N', 'N', 'N', 'R', 'R', 'N', 'N'],
          giulia: ['R', 'CE', 'C1', 'C1', 'C2', 'C2', 'R'],
          marta: ['A2', 'A2', 'F', 'F', 'A1', 'A1', 'R'],
          luca: ['C1', 'R', 'R', 'N', 'N', 'A2', 'A2'],
        },
        rules: {
          coverage: ['1 × A1', '1 × A2', '1 × C1', '1 × C2', '1 × N'],
          hard: ['C2 → A1 vietato', 'Priorità al notturno titolare', 'Mese definitivo non modificabile'],
          soft: ['Equilibrio mattina/pomeriggio', 'Evitare C1 → A1 e C2 → A2', 'Preferenze personali'],
        },
      },
      {
        id: 'pv-housekeeping',
        name: 'Housekeeping',
        jobTitles: ['Cameriere/a ai piani', 'Governante'],
        excludedJobTitles: ['Receptionist', 'Facchino'],
        ruleSetName: 'Palazzo Veneziano · Housekeeping',
        ruleSetVersion: 1,
        codes: [
          { code: 'M', label: 'Mattina', time: '08:00–16:00', color: '#3D7DCA' },
          { code: 'P', label: 'Pomeriggio', time: '12:00–20:00', color: '#9C4FC7' },
          { code: 'GOV', label: 'Governante', time: '08:00–16:00', color: '#E8541E' },
          { code: 'R', label: 'Riposo', time: '', color: '#9AA0A6' },
          { code: 'F', label: 'Ferie', time: '', color: '#C9A227', textColor: '#282014' },
        ],
        people: [
          { id: 'sara', name: 'Sara', initials: 'SA', jobTitle: 'Governante', assignmentProfile: 'Diurno', includedBy: 'job-title', restMode: 'fixed', restDays: 'Sab + Dom' },
          { id: 'elena', name: 'Elena', initials: 'EL', jobTitle: 'Cameriere/a ai piani', assignmentProfile: 'Diurno', includedBy: 'job-title', restMode: 'rotating' },
          { id: 'nadia', name: 'Nadia', initials: 'NA', jobTitle: 'Cameriere/a ai piani', assignmentProfile: 'Turnante', includedBy: 'job-title', restMode: 'rotating' },
          { id: 'ines', name: 'Ines', initials: 'IN', jobTitle: 'Cameriere/a ai piani', assignmentProfile: 'Diurno', includedBy: 'manual', restMode: 'fixed', restDays: 'Dom + Lun' },
        ],
        assignments: {
          sara: ['GOV', 'GOV', 'GOV', 'GOV', 'GOV', 'R', 'R'],
          elena: ['M', 'M', 'R', 'R', 'M', 'M', 'M'],
          nadia: ['P', 'P', 'M', 'M', 'R', 'R', 'P'],
          ines: ['R', 'M', 'M', 'P', 'P', 'M', 'R'],
        },
        rules: {
          coverage: ['3 × Mattina', '1 × Pomeriggio', '1 × Governante'],
          hard: ['Governante presente nei giorni operativi', 'Massimo 6 giorni consecutivi'],
          soft: ['Distribuire i weekend', 'Preferire continuità di fascia'],
        },
      },
    ],
  },
  {
    id: 'hotel-aurora',
    name: 'Hotel Aurora · esempio',
    units: [
      {
        id: 'aurora-front-office',
        name: 'Front Office',
        jobTitles: ['Receptionist'],
        excludedJobTitles: ['Front Office Manager'],
        ruleSetName: 'Preset neutro · Front Office',
        ruleSetVersion: 1,
        codes: [
          { code: 'M', label: 'Mattina', time: '07:00–15:00', color: '#3FA935' },
          { code: 'S', label: 'Sera', time: '15:00–23:00', color: '#F5A623', textColor: '#282014' },
          { code: 'N', label: 'Notte', time: '23:00–07:00', color: '#E63946' },
          { code: 'R', label: 'Riposo', time: '', color: '#9AA0A6' },
        ],
        people: [
          { id: 'alba', name: 'Alba', initials: 'AL', jobTitle: 'Receptionist', assignmentProfile: 'Diurno', includedBy: 'job-title', restMode: 'rotating' },
          { id: 'marco', name: 'Marco', initials: 'MR', jobTitle: 'Receptionist', assignmentProfile: 'Turnante', includedBy: 'job-title', restMode: 'rotating' },
          { id: 'noemi', name: 'Noemi', initials: 'NO', jobTitle: 'Receptionist', assignmentProfile: 'Notturno', includedBy: 'manual', restMode: 'fixed', restDays: 'Sab + Dom' },
        ],
        assignments: {
          alba: ['M', 'M', 'R', 'R', 'S', 'S', 'M'],
          marco: ['S', 'S', 'M', 'M', 'R', 'R', 'S'],
          noemi: ['N', 'N', 'N', 'R', 'R', 'N', 'N'],
        },
        rules: {
          coverage: ['1 × Mattina', '1 × Sera', '1 × Notte'],
          hard: ['Nessuna regola specifica ereditata da altri hotel'],
          soft: ['Equilibrare il numero di turni'],
        },
      },
    ],
  },
]

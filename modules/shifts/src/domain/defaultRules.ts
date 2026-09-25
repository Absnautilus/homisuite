export interface RuleDefinition {
  key: string
  text: string
}

export interface RoleCodes {
  base: string[]
  extra: string[]
}

export const ASSIGNMENT_ROLES: Array<{ key: string; label: string }> = [
  { key: 'day', label: 'Diurno' },
  { key: 'night', label: 'Notturno' },
  { key: 'rotating', label: 'Turnante' },
  { key: 'director', label: 'Direttore' },
  { key: 'fom', label: 'FOM' },
]

/**
 * Starting point for a new unit's role -> code eligibility (which codes
 * "Assegna automaticamente" may give to each role, as a primary pool and a
 * reserve pool used only when the primary pool can't cover a slot) --
 * matches the original Turni app's own hardcoded mapping for a hotel using
 * its sigle, but every property can edit it from Regole turni since
 * homisuite's shift codes are freely named per property.
 */
export const DEFAULT_ROLE_CODES: Record<string, RoleCodes> = {
  day: { base: ['C1', 'C2', 'A1', 'A2'], extra: ['CE'] },
  night: { base: ['N'], extra: [] },
  rotating: { base: ['C1', 'C2', 'A1', 'A2', 'N'], extra: ['CE'] },
  director: { base: ['D1', 'D2'], extra: [] },
  fom: { base: ['F1', 'F2'], extra: ['A1', 'A2', 'C1', 'C2'] },
}

export function initRoleCodes(stored: Record<string, RoleCodes> | undefined): Record<string, RoleCodes> {
  if (!stored || Object.keys(stored).length === 0) return DEFAULT_ROLE_CODES
  return Object.fromEntries(ASSIGNMENT_ROLES.map(({ key }) => [key, stored[key] ?? DEFAULT_ROLE_CODES[key]!]))
}

/**
 * Baseline hard/soft scheduling rules ported verbatim from the original
 * Turni app (Absnautilus/plannerturni), used as the fallback when a
 * planning unit's rule set hasn't had these configured yet -- mirrors
 * that app's own `statoSalvato.regoleAttive ?? DEFAULT` pattern instead
 * of a one-off data seed tied to a single property.
 */
export const DEFAULT_HARD_RULES: RuleDefinition[] = [
  { key: 'sequenzaC2A1Vietata', text: 'Sequenza vietata: un turno C2 non è mai seguito da A1 il giorno dopo.' },
  { key: 'prioritaNotturno', text: 'Priorità sulla notte (N): sempre al notturno titolare; il turnante copre solo quando il notturno è a riposo/ferie e solo nei suoi ultimi 2 giorni di lavoro prima del riposo; se anche il turnante non può, tocca al backup.' },
  { key: 'riposoTurnanteDopoNotturno', text: 'Riposo del turnante: riposa sempre subito dopo il notturno (stessa coppia di giorni, spostata di uno).' },
  { key: 'direttoreD1D2Auto', text: 'Direzione (D1/D2): nei giorni non di riposo, il Direttore fa sempre automaticamente D1 o D2, alternati per equilibrio.' },
  { key: 'fomF1F2Auto', text: 'FOM (F1/F2): nei giorni non di riposo, la FOM fa F1 o F2 — a meno che quel giorno non serva come riserva per un turno diurno scoperto.' },
  { key: 'ceAutomatico', text: 'Turno Centrale (CE): assegnato automaticamente ai diurni/turnanti che restano liberi quel giorno, una volta coperti tutti gli altri turni.' },
]

export const DEFAULT_SOFT_RULES: RuleDefinition[] = [
  { key: 'equilibrioMattinaPomeriggio', text: 'Equilibrio mattina/pomeriggio: la distribuzione di mattine (A1/A2) e pomeriggi/sere (C1/C2) viene bilanciata nel corso del mese.' },
  { key: 'sequenzaPreferibileEvitata', text: 'Sequenza da evitare: C1→A1 e C2→A2 vengono evitate quando possibile, usate solo se non c\'è alternativa.' },
  { key: 'equitaSequenzeScomode', text: 'Equità sulle sequenze scomode: chi ha ricevuto meno C1→A1/C2→A2 finora nel mese viene preferito.' },
  { key: 'variazioneSettimanale', text: 'Variazione settimanale: evita di assegnare lo stesso turno più volte alla stessa persona nella stessa settimana.' },
  { key: 'preferenzePersonali', text: 'Preferenze personali: tiene conto dell\'ordine di preferenza turni indicato da ciascun dipendente.' },
]

export function initRuleEnabled(catalog: RuleDefinition[], stored: string[]): Record<string, boolean> {
  if (stored.length === 0) return Object.fromEntries(catalog.map((rule) => [rule.key, true]))
  const storedSet = new Set(stored)
  return Object.fromEntries(catalog.map((rule) => [rule.key, storedSet.has(rule.text)]))
}

export function initRuleOrder(catalog: RuleDefinition[], stored: string[]): string[] {
  if (stored.length === 0) return catalog.map((rule) => rule.key)
  const textToKey = new Map(catalog.map((rule) => [rule.text, rule.key]))
  const ordered = stored.map((text) => textToKey.get(text)).filter((key): key is string => key != null)
  const missing = catalog.map((rule) => rule.key).filter((key) => !ordered.includes(key))
  return [...ordered, ...missing]
}

/**
 * Cycle length for the rest-day rotation (see domain/restRotation.ts): after
 * this many consecutive rest pairs, the next turn is a single day and the
 * weekday rotates back by one. Fixed at 3 in the original app; exposed here
 * as a per-unit setting since nothing about the algorithm requires it to be
 * a constant.
 */
export const DEFAULT_REST_ROTATION_PAIRS_PER_CYCLE = 3

export function initRestRotationPairsPerCycle(stored: number | undefined): number {
  return Number.isInteger(stored) && (stored as number) > 0 ? (stored as number) : DEFAULT_REST_ROTATION_PAIRS_PER_CYCLE
}

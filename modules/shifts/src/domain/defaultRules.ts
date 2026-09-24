export interface RuleDefinition {
  key: string
  text: string
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

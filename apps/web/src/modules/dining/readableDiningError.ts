// A thrown Supabase/Postgrest error is a plain {message, code, details, hint}
// object, not an instanceof Error -- checking only `cause.message` (or
// falling back to String(cause), which gives "[object Object]") silently
// swallows the real cause and always returns the generic fallback below.
// Same shape as useDiningAccess.ts's own errorMessage() helper.
function extractMessage(cause: unknown): string {
  if (cause && typeof cause === 'object') {
    const candidate = cause as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown }
    return [candidate.code, candidate.message, candidate.details, candidate.hint]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' · ')
  }
  return cause instanceof Error ? cause.message : String(cause)
}

export function readableDiningError(cause: unknown): string {
  const message = extractMessage(cause)
  if (/permission|forbidden|42501/i.test(message)) return 'Non hai i permessi necessari per questa operazione.'
  if (/closes_at|opens_at|restaurant_hours_closes_after_opens/i.test(message)) return 'L’orario di chiusura deve essere successivo a quello di apertura.'
  if (/confirmation_status/i.test(message)) return 'Stato di conferma non valido.'
  return 'Operazione non riuscita. Riprova.'
}

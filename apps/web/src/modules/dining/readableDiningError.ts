export function readableDiningError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  if (/permission|forbidden|42501/i.test(message)) return 'Non hai i permessi necessari per questa operazione.'
  if (/closes_at|opens_at|restaurant_hours_closes_after_opens/i.test(message)) return 'L’orario di chiusura deve essere successivo a quello di apertura.'
  if (/confirmation_status/i.test(message)) return 'Stato di conferma non valido.'
  return 'Operazione non riuscita. Riprova.'
}

// "Oggi" must mean today in the PROPERTY's timezone, not the browser's or
// UTC's -- new Date().toISOString() is UTC, so a reservation made at 00:30
// Europe/Rome (still 22:30 the previous day in UTC) would fall out of
// "oggi" and silently vanish from the ops summary until the UTC day rolled
// over, hours after local midnight had already passed. The en-CA locale
// formats as YYYY-MM-DD directly, so no string surgery is needed.
export function todayIso(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

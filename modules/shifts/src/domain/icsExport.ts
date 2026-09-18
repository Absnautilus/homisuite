import type { ShiftCode } from '../preview/fixtures'

export interface ShiftCalendarEvent {
  year: number
  month: number
  day: number
  code: string
}

const TIME_RANGE = /^(\d{2}):(\d{2})[–-](\d{2}):(\d{2})$/

function escapeIcs(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

function dateStamp(date: Date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function localDate(year: number, month: number, day: number, hour = 0, minute = 0) {
  return `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}00`
}

function compactDate(year: number, month: number, day: number) {
  return `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`
}

export function generateShiftCalendarIcs(
  personId: string,
  codes: ShiftCode[],
  events: ShiftCalendarEvent[],
  now = new Date(),
) {
  const definitions = new Map(codes.map((code) => [code.code, code]))
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Homisuite//Turni//IT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH']

  for (const event of events) {
    const definition = definitions.get(event.code)
    if (!definition || event.code === 'R') continue
    const uid = `${personId}-${event.year}${event.month}${event.day}-${event.code}@turni.homisuite`
    lines.push('BEGIN:VEVENT', `UID:${escapeIcs(uid)}`, `DTSTAMP:${dateStamp(now)}`)

    const time = definition.time.match(TIME_RANGE)
    if (time) {
      const [, startHour, startMinute, endHour, endMinute] = time
      const start = new Date(event.year, event.month - 1, event.day, Number(startHour), Number(startMinute))
      const end = new Date(event.year, event.month - 1, event.day, Number(endHour), Number(endMinute))
      if (end <= start) end.setDate(end.getDate() + 1)
      lines.push(
        `DTSTART:${localDate(start.getFullYear(), start.getMonth() + 1, start.getDate(), start.getHours(), start.getMinutes())}`,
        `DTEND:${localDate(end.getFullYear(), end.getMonth() + 1, end.getDate(), end.getHours(), end.getMinutes())}`,
      )
    } else {
      const end = new Date(event.year, event.month - 1, event.day + 1)
      lines.push(
        `DTSTART;VALUE=DATE:${compactDate(event.year, event.month, event.day)}`,
        `DTEND;VALUE=DATE:${compactDate(end.getFullYear(), end.getMonth() + 1, end.getDate())}`,
      )
    }

    lines.push(`SUMMARY:${escapeIcs(`${definition.code} · ${definition.label}`)}`, 'END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return `${lines.join('\r\n')}\r\n`
}

export function downloadShiftCalendar(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

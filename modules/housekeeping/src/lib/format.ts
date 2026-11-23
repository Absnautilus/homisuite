export function formatElapsed(from: string, to: Date = new Date()): string {
  const ms = to.getTime() - new Date(from).getTime()
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  if (minutes < 1) return 'ora'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

export function formatDuration(minutes: number): string {
  if (minutes < 1) return '<1 min'
  if (minutes < 60) return `${Math.round(minutes)} min`
  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes % 60)
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
}

// guest_requests_property_job_titles (the RPC both listQueueJobTitles and
// listPropertyJobTitles call) sorts alphabetically, which buries "Reception"
// -- usually the mansione staff reach for most often -- wherever it happens
// to fall among a hotel's other job titles. Pinned first here instead,
// leaving the rest in their existing (alphabetical) order.
export function sortJobTitlesReceptionFirst<T extends { name: string }>(jobTitles: T[]): T[] {
  return [...jobTitles].sort((a, b) => Number(b.name.trim().toLowerCase() === 'reception') - Number(a.name.trim().toLowerCase() === 'reception'))
}

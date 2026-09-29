/** Compact consecutive source dates without omitting any date. */
export function evidenceDatesLabel(dates: string[]): string {
  const days = [...new Set(dates)].sort()
  if (!days.length) return '—'
  const showYear = new Set(days.map((day) => day.slice(0, 4))).size > 1
  const label = (day: string) =>
    showYear ? day.replaceAll('-', '/') : day.slice(5).replace('-', '/')
  const consecutive = (left: string, right: string) =>
    Date.parse(`${right}T00:00:00Z`) - Date.parse(`${left}T00:00:00Z`) === 86400000
  const groups: string[] = []
  for (let start = 0; start < days.length;) {
    let end = start
    while (end + 1 < days.length && consecutive(days[end], days[end + 1])) end++
    if (end - start >= 2) groups.push(`${label(days[start])}~${label(days[end])}`)
    else for (let index = start; index <= end; index++) groups.push(label(days[index]))
    start = end + 1
  }
  return groups.join(', ')
}

/** Summary-sheet labels show the first three source dates; evidence stays intact. */
export function summaryEvidenceDatesLabel(dates: string[]): string {
  const days = [...new Set(dates)].sort()
  if (!days.length) return '—'
  const showYear = new Set(days.map((day) => day.slice(0, 4))).size > 1
  const label = (day: string) =>
    showYear ? day.replaceAll('-', '/') : day.slice(5).replace('-', '/')
  const shown = days.slice(0, 3).map(label).join(', ')
  return days.length > 3 ? `${shown} 외 ${days.length - 3}일` : shown
}

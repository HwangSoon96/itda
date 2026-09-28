import { CalendarDays, ChartNoAxesCombined, FileText, NotebookPen } from 'lucide-react'

export const navigation = [
  { key: 'record', label: '기록', Icon: NotebookPen },
  { key: 'schedule', label: '일정', Icon: CalendarDays },
  { key: 'progress', label: '경과', Icon: ChartNoAxesCombined },
  { key: 'summary', label: '요약지', Icon: FileText },
] as const
export type Page = (typeof navigation)[number]['key']
export function route(hash: string): Page {
  const value = hash.slice(1).split('?')[0]
  return navigation.some((item) => item.key === value) ? (value as Page) : 'record'
}

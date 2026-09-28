import type {
  EventCard,
  EventType,
  Health,
  Medication,
  MemoResult,
  MemoRevision,
  Question,
  Summary,
  Trends,
  Visit,
} from './types'

/** Data and actions required by screens, independent of HTTP routes and server DTOs. */
export interface Api {
  health(): Promise<Health>
  createMemo(body: { text: string; record_date: string; request_id?: string }): Promise<MemoResult>
  updateMemo(id: number, body: { text: string; request_id?: string }): Promise<MemoResult>
  confirmMemo(id: number, body: { events: EventCard[]; manual?: boolean }): Promise<MemoResult>
  memoRevisions(id: number): Promise<MemoRevision[]>
  retryMemo(id: number): Promise<MemoResult>
  memos(filters?: { from?: string; to?: string }): Promise<MemoResult[]>
  deleteMemo(id: number): Promise<void>
  addEvent(body: EventCard & { memo_id: number }): Promise<MemoResult>
  visits(): Promise<Visit[]>
  addVisit(body: { visit_date: string; status?: Visit['status'] }): Promise<Visit>
  updateVisit(id: number, body: { status: Visit['status'] }): Promise<Visit>
  deleteVisit(id: number): Promise<void>
  medications(): Promise<Medication[]>
  addMedication(body: Omit<Medication, 'id'>): Promise<Medication>
  deleteMedication(id: number): Promise<void>
  questions(): Promise<Question[]>
  addQuestion(body: { text: string; period_start?: string; period_end?: string }): Promise<Question>
  deleteQuestion(id: number): Promise<void>
  summary(asOf?: string, periodStart?: string | null, ai?: boolean): Promise<Summary>
  trends(type: EventType, asOf?: string, periodStart?: string | null): Promise<Trends>
  patient(): Promise<{ alias: string }>
  savePatient(body: { alias: string }): Promise<{ alias: string }>
  loadDemo(): Promise<{ ok: boolean; workspace_id: string }>
  exitDemo(): Promise<{ ok: boolean; workspace_id: string }>
}

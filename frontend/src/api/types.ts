export const EVENT_TYPES = [
  '야간 각성',
  '배회·출입문 시도',
  '초조·공격',
  '과민·짜증',
  '불안',
  '우울·무기력',
  '망상',
  '환각',
  '식사량 감소',
  '복약 거부',
  '사람·장소 혼동',
  '낙상',
] as const
export type EventType = (typeof EVENT_TYPES)[number]
/** An observation on its owning memo's record_date; no independent calendar date. */
export interface EventCard {
  type: EventType
  status: '있었음' | '없었음'
  time_expr: string | null
  count: number
  evidence: string
  model_event_index?: number | null
}
export interface MemoResult {
  memo_id: number
  status: '확인 대기' | '확인 완료' | '정리 실패'
  emergency: { matched: boolean; message: string | null }
  events: EventCard[]
  text: string
  /** Date selected by the caregiver; shared by every event in this memo. */
  record_date: string
  error?: string | null
  model_output?: string | null
  failure_code?:
    | 'connection_error'
    | 'model_not_found'
    | 'timeout'
    | 'invalid_format'
    | 'evidence_mismatch'
    | 'time_mismatch'
    | 'interrupted'
    | 'unknown_error'
    | null
}
export interface MemoRevision {
  id: number
  created_at: string
  kind: '최초 확인' | '정정' | '직접 추가' | '수동 확인'
  before_events: EventCard[]
  after_events: EventCard[]
}
export interface Visit {
  id: number
  visit_date: string
  status: '예정' | '완료'
}
export interface Medication {
  id: number
  name: string
  change_type: '시작' | '증량' | '감량' | '중단'
  change_date: string
}
export interface Question {
  id: number
  text: string
  created_at: string
  period_start?: string | null
  period_end?: string | null
}
export interface Health {
  workspace_id: string
  ok: boolean
  ai_available: boolean | null
  model_name: string
  allow_lan: boolean
  emergency_keywords: string[]
  emergency_message: string
  ai_notice: string
  disclaimer: string
  demo_loaded?: boolean
  demo_as_of?: string
  temporary_model?: boolean
}
export interface Period {
  start: string
  end: string
}
export interface SummaryRow {
  type: EventType
  baseline_rate: number | null
  current_rate: number | null
  weekly_count: number | null
  mark: '증가' | '새로 나타남' | '비교 불가' | '기록 부족' | null
  evidence_dates: string[]
  memo_ids: number[]
  occurrence_days: number
  recorded_days: number
  mentioned_days?: number
  absent_days?: number
  unmentioned_days?: number
  baseline_recorded_days?: number
  baseline_occurrence_days?: number
  baseline_mentioned_days?: number
  baseline_absent_days?: number
  baseline_unmentioned_days?: number
}
export interface Summary {
  patient_alias: string
  period: Period
  baseline: Period | null
  coverage: { recorded_days: number; total_days: number }
  baseline_coverage?: { recorded_days: number; total_days: number } | null
  exclusions?: {
    pending_memo_ids: number[]
    failed_memo_ids: number[]
  }
  summary_source?: 'llm' | 'template'
  basis_note?: string
  trends?: Trends[]
  markers?: SummaryMarker[]
  rows: SummaryRow[]
  sentences: {
    scope?: 'current' | 'baseline' | 'comparison'
    types?: EventType[]
    text: string
    evidence_dates: string[]
    memo_ids?: number[]
  }[]
  medications: { name: string; change_type: string; date: string }[]
  falls: string[]
  questions: string[]
  disclaimer: string
}
export interface SummaryMarker {
  kind: 'visit' | 'medication'
  date: string
  label: string
}
export interface Trends {
  markers?: SummaryMarker[]
  type: EventType
  period: Period
  baseline: Period | null
  weeks: {
    start: string
    end: string
    period: 'baseline' | 'current'
    rate: number | null
    recorded_days: number
    event_days: number
    low_coverage: boolean
  }[]
  medications: { name: string; change_type: string; date: string }[]
}

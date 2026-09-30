import { ApiError } from './client'
import {
  EVENT_TYPES,
  type EventCard,
  type EventType,
  type Health,
  type Medication,
  type MemoResult,
  type MemoRevision,
  type Period,
  type Question,
  type Summary,
  type SummaryMarker,
  type SummaryRow,
  type PeriodInfo,
  type Trends,
  type Visit,
} from './types'

type Decoder<T> = (value: unknown, path: string) => T
type JsonObject = Record<string, unknown>

function invalid(path: string): never {
  throw new ApiError(`서버 응답 형식을 확인하지 못했어요. (${path})`, 502, 'invalid_response')
}
const object: Decoder<JsonObject> = (value, path) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(path)
  return value as JsonObject
}
const string: Decoder<string> = (value, path) => (typeof value === 'string' ? value : invalid(path))
const boolean: Decoder<boolean> = (value, path) =>
  typeof value === 'boolean' ? value : invalid(path)
const number: Decoder<number> = (value, path) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : invalid(path)
const count: Decoder<number> = (value, path) => {
  const result = number(value, path)
  return Number.isSafeInteger(result) ? result : invalid(path)
}
const id: Decoder<number> = (value, path) => {
  const result = count(value, path)
  return result > 0 ? result : invalid(path)
}
const rate: Decoder<number> = (value, path) => {
  const result = number(value, path)
  return result <= 1 ? result : invalid(path)
}
const date: Decoder<string> = (value, path) => {
  const result = string(value, path)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) return invalid(path)
  const [year, month, day] = result.split('-').map(Number)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    ? result
    : invalid(path)
}
const timestamp: Decoder<string> = (value, path) => {
  const result = string(value, path)
  date(result.slice(0, 10), path)
  if (result.length === 10) return result
  if (
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/.test(
      result,
    ) ||
    !Number.isFinite(Date.parse(result))
  )
    return invalid(path)
  return result
}
function nullable<T>(decode: Decoder<T>): Decoder<T | null> {
  return (value, path) => (value === null ? null : decode(value, path))
}
function array<T>(decode: Decoder<T>): Decoder<T[]> {
  return (value, path) => {
    if (!Array.isArray(value)) return invalid(path)
    return value.map((item, index) => decode(item, `${path}[${index}]`))
  }
}
function enumeration<const T extends string>(values: readonly T[]): Decoder<T> {
  return (value, path) => {
    const result = string(value, path)
    return values.includes(result as T) ? (result as T) : invalid(path)
  }
}
function mapped<T extends string>(values: Record<string, T>): Decoder<T> {
  return (value, path) => {
    const result = string(value, path)
    return Object.hasOwn(values, result) ? values[result] : invalid(path)
  }
}
function optional<T>(source: JsonObject, key: string, decode: Decoder<T>, path: string) {
  return source[key] === undefined ? undefined : decode(source[key], `${path}.${key}`)
}
function fallback<T>(source: JsonObject, key: string, decode: Decoder<T>, value: T, path: string) {
  return optional(source, key, decode, path) ?? value
}

const EVENT_CODES = [
  'night_waking',
  'wandering_exit',
  'agitation',
  'irritability',
  'anxiety',
  'low_mood_apathy',
  'delusion',
  'hallucination',
  'reduced_intake',
  'medication_refusal',
  'confusion',
  'fall',
] as const
const eventType = mapped<EventType>(
  Object.fromEntries(
    EVENT_TYPES.flatMap((label, index) => [
      [label, label],
      [EVENT_CODES[index], label],
    ]),
  ),
)
const eventStatus = mapped<EventCard['status']>({
  present: '있었음',
  absent: '없었음',
  있었음: '있었음',
  없었음: '없었음',
})
const memoStatus = mapped<MemoResult['status']>({
  pending: '확인 대기',
  confirmed: '확인 완료',
  failed: '정리 실패',
  '확인 대기': '확인 대기',
  '확인 완료': '확인 완료',
  '정리 실패': '정리 실패',
})
const visitStatus = mapped<Visit['status']>({
  scheduled: '예정',
  completed: '완료',
  예정: '예정',
  완료: '완료',
})
const medicationChange = mapped<Medication['change_type']>({
  start: '시작',
  increase: '증량',
  decrease: '감량',
  stop: '중단',
  시작: '시작',
  증량: '증량',
  감량: '감량',
  중단: '중단',
})
const changeMark = mapped<NonNullable<SummaryRow['mark']>>({
  increase: '증가',
  new: '새로 나타남',
  not_comparable: '비교 불가',
  insufficient: '기록 부족',
  증가: '증가',
  '새로 나타남': '새로 나타남',
  '비교 불가': '비교 불가',
  '기록 부족': '기록 부족',
})
const failureCode = enumeration([
  'connection_error',
  'model_not_found',
  'timeout',
  'invalid_format',
  'evidence_mismatch',
  'time_mismatch',
  'interrupted',
  'unknown_error',
])

/** Request encoders keep wire codes out of components and UI state. */
export function wireEventType(value: EventType) {
  return EVENT_CODES[EVENT_TYPES.indexOf(eventType(value, 'event.type'))]
}
export function wireVisitStatus(value: Visit['status']) {
  return visitStatus(value, 'visit.status') === '예정' ? 'scheduled' : 'completed'
}
export function wireMedicationChange(value: Medication['change_type']) {
  const codes = { 시작: 'start', 증량: 'increase', 감량: 'decrease', 중단: 'stop' } as const
  return codes[medicationChange(value, 'medication.change_type')]
}
export function wireEvent(value: EventCard) {
  const checked = event(value, 'event')
  return {
    ...checked,
    type: wireEventType(checked.type),
    status: checked.status === '있었음' ? 'present' : 'absent',
  }
}

const event: Decoder<EventCard> = (value, path) => {
  const data = object(value, path)
  return {
    type: eventType(data.type, `${path}.type`),
    status: eventStatus(data.status, `${path}.status`),
    time_expr: nullable(string)(data.time_expr, `${path}.time_expr`),
    count: id(data.count, `${path}.count`),
    evidence: string(data.evidence, `${path}.evidence`),
    model_event_index: optional(data, 'model_event_index', nullable(count), path),
  }
}
const memo: Decoder<MemoResult> = (value, path) => {
  const data = object(value, path)
  const emergency = object(data.emergency, `${path}.emergency`)
  return {
    memo_id: id(data.memo_id, `${path}.memo_id`),
    status: memoStatus(data.status, `${path}.status`),
    emergency: {
      matched: boolean(emergency.matched, `${path}.emergency.matched`),
      message: nullable(string)(emergency.message, `${path}.emergency.message`),
    },
    events: array(event)(data.events, `${path}.events`),
    text: string(data.text, `${path}.text`),
    record_date: date(data.record_date, `${path}.record_date`),
    error: optional(data, 'error', nullable(string), path),
    model_output: optional(data, 'model_output', nullable(string), path),
    failure_code: optional(data, 'failure_code', nullable(failureCode), path),
  }
}
const revision: Decoder<MemoRevision> = (value, path) => {
  const data = object(value, path)
  return {
    id: id(data.id, `${path}.id`),
    created_at: timestamp(data.created_at, `${path}.created_at`),
    kind: enumeration(['최초 확인', '정정', '직접 추가', '수동 확인'])(data.kind, `${path}.kind`),
    before_events: array(event)(data.before_events, `${path}.before_events`),
    after_events: array(event)(data.after_events, `${path}.after_events`),
  }
}
const visit: Decoder<Visit> = (value, path) => {
  const data = object(value, path)
  return {
    id: id(data.id, `${path}.id`),
    visit_date: date(data.visit_date, `${path}.visit_date`),
    status: visitStatus(data.status, `${path}.status`),
  }
}
const medication: Decoder<Medication> = (value, path) => {
  const data = object(value, path)
  return {
    id: id(data.id, `${path}.id`),
    name: string(data.name, `${path}.name`),
    change_type: medicationChange(data.change_type, `${path}.change_type`),
    change_date: date(data.change_date, `${path}.change_date`),
  }
}
const question: Decoder<Question> = (value, path) => {
  const data = object(value, path)
  return {
    id: id(data.id, `${path}.id`),
    text: string(data.text, `${path}.text`),
    created_at: timestamp(data.created_at, `${path}.created_at`),
    period_start: optional(data, 'period_start', nullable(date), path),
    period_end: optional(data, 'period_end', nullable(date), path),
  }
}
const period: Decoder<Period> = (value, path) => {
  const data = object(value, path)
  const result = { start: date(data.start, `${path}.start`), end: date(data.end, `${path}.end`) }
  return result.start <= result.end ? result : invalid(path)
}
const coverage: Decoder<Summary['coverage']> = (value, path) => {
  const data = object(value, path)
  return {
    recorded_days: count(data.recorded_days, `${path}.recorded_days`),
    total_days: count(data.total_days, `${path}.total_days`),
  }
}
const marker: Decoder<SummaryMarker> = (value, path) => {
  const data = object(value, path)
  return {
    kind: enumeration(['visit', 'medication'])(data.kind, `${path}.kind`),
    date: date(data.date, `${path}.date`),
    label: string(data.label, `${path}.label`),
  }
}
const reportMedication: Decoder<Summary['medications'][number]> = (value, path) => {
  const data = object(value, path)
  return {
    name: string(data.name, `${path}.name`),
    change_type: medicationChange(data.change_type, `${path}.change_type`),
    date: date(data.date, `${path}.date`),
  }
}
const row: Decoder<SummaryRow> = (value, path) => {
  const data = object(value, path)
  return {
    type: eventType(data.type, `${path}.type`),
    baseline_rate: nullable(rate)(data.baseline_rate, `${path}.baseline_rate`),
    current_rate: nullable(rate)(data.current_rate, `${path}.current_rate`),
    weekly_count: nullable(number)(data.weekly_count, `${path}.weekly_count`),
    mark: nullable(changeMark)(data.mark, `${path}.mark`),
    evidence_dates: array(date)(data.evidence_dates, `${path}.evidence_dates`),
    memo_ids: array(id)(data.memo_ids, `${path}.memo_ids`),
    occurrence_days: count(data.occurrence_days, `${path}.occurrence_days`),
    recorded_days: count(data.recorded_days, `${path}.recorded_days`),
    mentioned_days: optional(data, 'mentioned_days', count, path),
    absent_days: optional(data, 'absent_days', count, path),
    unmentioned_days: optional(data, 'unmentioned_days', count, path),
    baseline_recorded_days: optional(data, 'baseline_recorded_days', count, path),
    baseline_occurrence_days: optional(data, 'baseline_occurrence_days', count, path),
    baseline_mentioned_days: optional(data, 'baseline_mentioned_days', count, path),
    baseline_absent_days: optional(data, 'baseline_absent_days', count, path),
    baseline_unmentioned_days: optional(data, 'baseline_unmentioned_days', count, path),
  }
}
const sentence: Decoder<Summary['sentences'][number]> = (value, path) => {
  const data = object(value, path)
  return {
    scope: optional(data, 'scope', enumeration(['current', 'baseline', 'comparison']), path),
    types: optional(data, 'types', array(eventType), path),
    text: string(data.text, `${path}.text`),
    evidence_dates: array(date)(data.evidence_dates, `${path}.evidence_dates`),
    memo_ids: optional(data, 'memo_ids', array(id), path),
  }
}
const exclusions: Decoder<NonNullable<Summary['exclusions']>> = (value, path) => {
  const data = object(value, path)
  return {
    pending_memo_ids: array(id)(data.pending_memo_ids, `${path}.pending_memo_ids`),
    failed_memo_ids: array(id)(data.failed_memo_ids, `${path}.failed_memo_ids`),
  }
}
const week: Decoder<Trends['weeks'][number]> = (value, path) => {
  const data = object(value, path)
  return {
    ...period(data, path),
    period: enumeration(['baseline', 'current'])(data.period, `${path}.period`),
    rate: nullable(rate)(data.rate, `${path}.rate`),
    recorded_days: count(data.recorded_days, `${path}.recorded_days`),
    event_days: count(data.event_days, `${path}.event_days`),
    low_coverage: boolean(data.low_coverage, `${path}.low_coverage`),
  }
}
const trends: Decoder<Trends> = (value, path) => {
  const data = object(value, path)
  return {
    type: eventType(data.type, `${path}.type`),
    period: period(data.period, `${path}.period`),
    baseline: nullable(period)(data.baseline, `${path}.baseline`),
    markers: optional(data, 'markers', array(marker), path),
    weeks: array(week)(data.weeks, `${path}.weeks`),
    medications: array(reportMedication)(data.medications, `${path}.medications`),
  }
}
const periodInfo: Decoder<PeriodInfo> = (value, path) => {
  const data = object(value, path)
  return {
    period: period(data.period, `${path}.period`),
    baseline: nullable(period)(data.baseline, `${path}.baseline`),
  }
}
const summary: Decoder<Summary> = (value, path) => {
  const data = object(value, path)
  return {
    patient_alias: string(data.patient_alias, `${path}.patient_alias`),
    period: period(data.period, `${path}.period`),
    baseline: nullable(period)(data.baseline, `${path}.baseline`),
    coverage: coverage(data.coverage, `${path}.coverage`),
    baseline_coverage: optional(data, 'baseline_coverage', nullable(coverage), path),
    exclusions: optional(data, 'exclusions', exclusions, path),
    summary_source: optional(data, 'summary_source', enumeration(['llm', 'template']), path),
    basis_note: optional(data, 'basis_note', string, path),
    trends: optional(data, 'trends', array(trends), path),
    markers: optional(data, 'markers', array(marker), path),
    rows: array(row)(data.rows, `${path}.rows`),
    sentences: array(sentence)(data.sentences, `${path}.sentences`),
    medications: array(reportMedication)(data.medications, `${path}.medications`),
    falls: array(date)(data.falls, `${path}.falls`),
    questions: array(string)(data.questions, `${path}.questions`),
    disclaimer: string(data.disclaimer, `${path}.disclaimer`),
  }
}
const health: Decoder<Health> = (value, path) => {
  const data = object(value, path)
  return {
    ok: boolean(data.ok, `${path}.ok`),
    workspace_id: fallback(data, 'workspace_id', string, '', path),
    ai_available: fallback(data, 'ai_available', nullable(boolean), null, path),
    model_name: fallback(data, 'model_name', string, '', path),
    allow_lan: fallback(data, 'allow_lan', boolean, false, path),
    emergency_keywords: fallback(data, 'emergency_keywords', array(string), [], path),
    emergency_message: fallback(data, 'emergency_message', string, '', path),
    ai_notice: fallback(data, 'ai_notice', string, '', path),
    disclaimer: fallback(data, 'disclaimer', string, '', path),
    demo_loaded: optional(data, 'demo_loaded', boolean, path),
    demo_as_of: optional(data, 'demo_as_of', date, path),
    temporary_model: optional(data, 'temporary_model', boolean, path),
  }
}

/** These types describe the data consumed by screens, independently of wire envelopes. */
export const decoders = {
  health: (value: unknown) => health(value, 'health'),
  memo: (value: unknown) => memo(value, 'memo'),
  memos: (value: unknown) => array(memo)(value, 'memos'),
  revisions: (value: unknown) => array(revision)(value, 'revisions'),
  visit: (value: unknown) => visit(value, 'visit'),
  visits: (value: unknown) => array(visit)(value, 'visits'),
  medication: (value: unknown) => medication(value, 'medication'),
  medications: (value: unknown) => array(medication)(value, 'medications'),
  question: (value: unknown) => question(value, 'question'),
  questions: (value: unknown) => array(question)(value, 'questions'),
  summary: (value: unknown) => summary(value, 'summary'),
  summaryPeriod: (value: unknown) => periodInfo(value, 'summaryPeriod'),
  trends: (value: unknown) => trends(value, 'trends'),
  patient: (value: unknown) => ({ alias: string(object(value, 'patient').alias, 'patient.alias') }),
  workspace: (value: unknown) => {
    const data = object(value, 'workspace')
    const workspaceId = string(data.workspace_id, 'workspace.workspace_id')
    if (!workspaceId.trim()) invalid('workspace.workspace_id')
    return { ok: boolean(data.ok, 'workspace.ok'), workspace_id: workspaceId }
  },
  empty: (value: unknown): void => {
    if (value !== undefined && value !== null) invalid('empty')
  },
}

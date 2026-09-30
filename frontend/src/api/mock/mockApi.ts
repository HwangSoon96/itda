import { questionInPeriod } from '../../shared/lib/visitPreparation'
// Explicit development fixture. This module never calls an AI service or persists health data.
import type { Api } from '../itdaApi'
import demoMemos from './fixtures/demo_memos.json'
import demoEvents from './fixtures/demo_events.json'
import demoContext from './fixtures/demo_context.json'
import { EVENT_TYPES } from '../types'
import { localToday } from '../../shared/lib/date'
import type {
  EventCard,
  EventType,
  Health,
  Medication,
  MemoResult,
  MemoRevision,
  Period,
  Question,
  Summary,
  SummaryRow,
  SummaryMarker,
  Trends,
  Visit,
} from '../types'

const SAMPLE_TEXT = '새벽 3시쯤 깨서 현관문 열려고 하심. 저녁은 반 공기.'
const SAMPLE_AS_OF = demoContext.as_of
const EMERGENCY_MESSAGE =
  '생명이 위험하거나 응급 상황이면 즉시 119에 연락하세요. 어르신이 실종되었다면 112에 신고하세요. 치매 관련 상담은 치매상담콜센터 1899-9988, 마음이 힘드실 때는 자살예방 상담전화 109로 연락하실 수 있어요.'
const EMERGENCY_KEYWORDS = [
  '의식이 없',
  '안 깨어나',
  '숨을 안 쉬',
  '숨이 차',
  '머리를 부딪',
  '피가 많이',
  '못 일어나',
  '경련',
  '발작',
  '없어졌',
  '못 찾',
  '나가서 안 돌아',
  '죽고 싶',
  '약을 한꺼번에',
]
const DISCLAIMER =
  '보호자 일지 자동 정리본이며 표준화된 임상 척도 점수가 아니고 진단적 판단을 포함하지 않음'
type ModelEvent = Pick<EventCard, 'type' | 'status' | 'time_expr' | 'count' | 'evidence'>
type DemoMemo = {
  id: number
  record_date: string
  text: string
  status: MemoResult['status']
  model_events?: ModelEvent[]
  error?: string
}
type State = {
  memos: MemoResult[]
  visits: Visit[]
  medications: Medication[]
  questions: Question[]
  alias: string
  sequence: number
  requests: Record<string, number>
  updateRequests: Map<string, { memoId: number; text: string }>
  deletedRequests: Set<string>
  modelCounts: Record<number, number>
  revisions: Record<number, MemoRevision[]>
}
type ReportRow = SummaryRow & {
  occurrence_dates: string[]
  current_evidence_dates: string[]
  current_memo_ids: number[]
  baseline_recorded_days: number
  upper_limit: number | null
}
let state: State = {
  memos: [],
  visits: [],
  medications: [],
  questions: [],
  alias: demoContext.patient_alias,
  sequence: 1,
  requests: {},
  updateRequests: new Map(),
  deletedRequests: new Set(),
  modelCounts: {},
  revisions: {},
}
let backup: State | null = null
let savedDemo: State | null = null
let demo = false
let workspaceId = crypto.randomUUID()
const copy = <T>(value: T): T => structuredClone(value)
const nextId = () => state.sequence++
const shift = (value: string, days: number) => {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
const days = (start: string, end: string) =>
  Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000) + 1
const containsDate = (period: Period, date: string | null) =>
  Boolean(date && date >= period.start && date <= period.end)
const percentLabel = (value: number | null) => {
  const percentage = (value ?? 0) * 100
  if (percentage > 0 && percentage < 1) return '<1'
  return Math.round(percentage)
}
const emergency = (text: string) => {
  const matched = EMERGENCY_KEYWORDS.some((keyword) => text.includes(keyword))
  return { matched, message: matched ? EMERGENCY_MESSAGE : null }
}
const memoById = (id: number) => {
  const memo = state.memos.find((item) => item.memo_id === id)
  if (!memo) throw new Error('해당 샘플 메모를 찾지 못했어요.')
  return memo
}
const requireText = (value: string, max: number, label: string) => {
  if (!value.trim() || value.length > max)
    throw new Error(`${label}은 1~${max.toLocaleString()}자로 적어 주세요.`)
}
const validateDate = (value: string) => {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(`${value}T12:00:00Z`)) ||
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value
  )
    throw new Error('올바른 날짜를 골라 주세요.')
}
function validateEvent(event: EventCard, memo: MemoResult) {
  if (!EVENT_TYPES.includes(event.type) || !['있었음', '없었음'].includes(event.status))
    throw new Error('유형과 관찰 상태를 확인해 주세요.')
  if (!Number.isInteger(event.count) || event.count < 1)
    throw new Error('횟수는 1 이상의 정수로 적어 주세요.')
  if (
    !event.evidence.trim() ||
    event.evidence.length > 10000 ||
    !memo.text.includes(event.evidence)
  )
    throw new Error('근거 구절은 원문에 있는 내용으로 적어 주세요.')
  if (
    event.time_expr !== null &&
    (!event.time_expr.trim() ||
      event.time_expr.length > 200 ||
      !memo.text.includes(event.time_expr))
  )
    throw new Error('시간 표현은 원문에 있는 내용으로 적어 주세요.')
}
const eventCard = (type: EventType, evidence: string, count = 1): EventCard => ({
  type,
  status: '있었음',
  time_expr: null,
  count,
  evidence,
})
const modelFields = ({
  type,
  status,
  time_expr,
  count,
  evidence,
}: EventCard | ModelEvent): ModelEvent => ({ type, status, time_expr, count, evidence })
function draftCard(event: ModelEvent, index: number): EventCard {
  return { ...event, model_event_index: index }
}
function seed() {
  const memos = demoMemos as DemoMemo[]
  const events = demoEvents as (EventCard & { memo_id: number })[]
  state = {
    memos: [],
    visits: [],
    medications: [],
    questions: [],
    alias: demoContext.patient_alias,
    sequence: Math.max(0, ...memos.map((memo) => memo.id)) + 1,
    requests: {},
    updateRequests: new Map(),
    deletedRequests: new Set(),
    modelCounts: {},
    revisions: {},
  }
  state.visits = demoContext.visits.map((visit) => ({
    id: nextId(),
    visit_date: visit.visit_date,
    status: visit.status as Visit['status'],
  }))
  state.medications = demoContext.medications.map((item) => ({
    id: nextId(),
    ...item,
    change_type: item.change_type as Medication['change_type'],
  }))
  state.questions = demoContext.questions.map((item) => ({ id: nextId(), ...item }))
  state.memos = memos.map((memo) => {
    const approved = events
      .filter((event) => event.memo_id === memo.id)
      .map(({ memo_id: _memoId, ...event }) => event)
    const original =
      memo.status === '확인 완료' ? approved.map(modelFields) : (memo.model_events ?? null)
    const cards =
      memo.status === '확인 완료'
        ? approved.map((event, index) => ({ ...event, model_event_index: index }))
        : memo.status === '확인 대기'
          ? (original ?? []).map((event, index) => draftCard(event, index))
          : []
    state.modelCounts[memo.id] = original?.length ?? 0
    return {
      memo_id: memo.id,
      status: memo.status,
      record_date: memo.record_date,
      text: memo.text,
      events: cards,
      emergency: emergency(memo.text),
      model_output: original === null ? null : JSON.stringify(original),
      error: memo.error ?? null,
    }
  })
}
function sampleEvents(text: string): EventCard[] | null {
  // Only this exact example has fixture results. Arbitrary input is never presented as AI analysis.
  if (text.trim() !== SAMPLE_TEXT) return null
  return [
    { ...eventCard('야간 각성', '3시쯤 깨서'), time_expr: '새벽' },
    { ...eventCard('배회·출입문 시도', '현관문 열려고 하심'), time_expr: '새벽' },
    eventCard('식사량 감소', '저녁은 반 공기'),
  ].map((event, index) => ({ ...event, model_event_index: index }))
}
function periods(asOf: string, periodStart?: string | null) {
  validateDate(asOf)
  if (periodStart) {
    validateDate(periodStart)
    if (periodStart > asOf) throw new Error('시작일은 기준 날짜보다 늦을 수 없어요.')
  }
  const visits = state.visits
    .filter((item) => item.status === '완료' && item.visit_date <= asOf)
    .map((item) => item.visit_date)
    .sort()
  const confirmed = state.memos.filter((item) => item.status === '확인 완료')
  const knownDays = confirmed.map((memo) => memo.record_date)
  const start =
    periodStart ?? visits.at(-1) ?? knownDays.filter((day) => day <= asOf).sort()[0] ?? asOf
  const previous = visits.filter((day) => day < start).at(-1)
  return {
    current: { start, end: asOf },
    baseline: previous ? { start: previous, end: shift(start, -1) } : null,
  }
}
function observations(period: Period, type?: EventType) {
  const recorded = new Set<string>(),
    present = new Set<string>(),
    absent = new Set<string>(),
    mentioned = new Set<string>(),
    memoIds = new Set<number>()
  const evidenceDates = new Set<string>(),
    presentEvidenceDates = new Set<string>(),
    presentMemoIds = new Set<number>()
  let count = 0
  for (const memo of state.memos) {
    if (memo.status !== '확인 완료' || !containsDate(period, memo.record_date)) continue
    recorded.add(memo.record_date)
    for (const event of memo.events) {
      if (type && event.type !== type) continue
      mentioned.add(memo.record_date)
      memoIds.add(memo.memo_id)
      evidenceDates.add(memo.record_date)
      if (event.status === '있었음') {
        present.add(memo.record_date)
        count += event.count
        presentEvidenceDates.add(memo.record_date)
        presentMemoIds.add(memo.memo_id)
      } else absent.add(memo.record_date)
    }
  }
  for (const day of present) absent.delete(day)
  return {
    recorded,
    present,
    absent,
    mentioned,
    memoIds,
    evidenceDates,
    presentEvidenceDates,
    presentMemoIds,
    count,
  }
}
function summary(asOf: string, periodStart?: string | null): Summary {
  const { current, baseline } = periods(asOf, periodStart)
  const coverage = observations(current).recorded.size
  const rows: ReportRow[] = EVENT_TYPES.map((type) => {
    const currentData = observations(current, type),
      baseData = baseline ? observations(baseline, type) : null
    const currentRate = coverage ? currentData.present.size / coverage : null
    const baselineRate = baseData?.recorded.size
      ? baseData.present.size / baseData.recorded.size
      : null
    let mark: SummaryRow['mark'] =
      baselineRate === null ? '비교 불가' : coverage < 14 ? '기록 부족' : null
    if (!mark && currentRate !== null && baselineRate !== null) {
      if (baselineRate === 0 && currentData.present.size > 0) mark = '새로 나타남'
      else if (
        currentData.present.size >= 3 &&
        currentRate > baselineRate + 3 * Math.sqrt((baselineRate * (1 - baselineRate)) / coverage)
      )
        mark = '증가'
    }
    const enoughRecords = mark !== '기록 부족' && mark !== '비교 불가'
    return {
      type,
      baseline_rate: baselineRate,
      current_rate: currentRate,
      weekly_count: coverage && enoughRecords ? (currentData.count / coverage) * 7 : null,
      mark,
      evidence_dates: [
        ...new Set([...(baseData?.evidenceDates ?? []), ...currentData.evidenceDates]),
      ].sort(),
      memo_ids: [...new Set([...(baseData?.memoIds ?? []), ...currentData.memoIds])].sort(
        (a, b) => a - b,
      ),
      current_evidence_dates: [...currentData.presentEvidenceDates].sort(),
      current_memo_ids: [...currentData.presentMemoIds].sort((a, b) => a - b),
      occurrence_days: currentData.present.size,
      occurrence_dates: [...currentData.present].sort(),
      recorded_days: coverage,
      mentioned_days: currentData.mentioned.size,
      absent_days: currentData.absent.size,
      baseline_recorded_days: baseData?.recorded.size ?? 0,
      unmentioned_days: coverage - currentData.mentioned.size,
      baseline_mentioned_days: baseData?.mentioned.size ?? 0,
      baseline_occurrence_days: baseData?.present.size ?? 0,
      baseline_absent_days: baseData?.absent.size ?? 0,
      baseline_unmentioned_days: (baseData?.recorded.size ?? 0) - (baseData?.mentioned.size ?? 0),
      upper_limit:
        baselineRate !== null && baselineRate > 0 && coverage
          ? baselineRate + 3 * Math.sqrt((baselineRate * (1 - baselineRate)) / coverage)
          : null,
    }
  })
  const fallRow = rows.find((row) => row.type === '낙상')!
  const falls = fallRow.occurrence_dates
  const coverageSources = (period: Period | null) => {
    const contributing = period
      ? state.memos.filter(
          (memo) => memo.status === '확인 완료' && containsDate(period, memo.record_date),
        )
      : []
    return {
      evidence_dates: [...new Set(contributing.map((memo) => memo.record_date))].sort(),
      memo_ids: contributing.map((memo) => memo.memo_id).sort((a, b) => a - b),
    }
  }
  const sentences: Summary['sentences'] = []
  if (falls.length)
    sentences.push({
      scope: 'current',
      types: ['낙상'],
      text: `낙상: ${falls.slice(0, 3).join(', ')}${falls.length > 3 ? ` 외 ${falls.length - 3}일` : ''}에 기록됨.`,
      evidence_dates: fallRow.current_evidence_dates,
      memo_ids: fallRow.current_memo_ids,
    })
  const signals = rows
    .filter((row) => row.type !== '낙상' && (row.mark === '증가' || row.mark === '새로 나타남'))
    .sort(
      (a, b) =>
        Number(b.mark === '새로 나타남') - Number(a.mark === '새로 나타남') ||
        (b.current_rate ?? 0) -
          (b.baseline_rate ?? 0) -
          ((a.current_rate ?? 0) - (a.baseline_rate ?? 0)),
    )
  for (const row of signals) {
    if (row.mark === '새로 나타남')
      sentences.push({
        scope: 'current',
        types: [row.type],
        text: `${row.type}: 기준 구간에는 기록이 없었고 이번 구간 ${row.occurrence_dates[0]}에 처음 기록됨 (총 ${row.occurrence_days}일).`,
        evidence_dates: row.current_evidence_dates,
        memo_ids: row.current_memo_ids,
      })
    else
      sentences.push({
        scope: 'comparison',
        types: [row.type],
        text: `${row.type}: 발생일 비율이 기준 구간 ${percentLabel(row.baseline_rate)}%에서 이번 구간 ${percentLabel(row.current_rate)}%로 증가 표시됨 (기록일 ${row.recorded_days}일 중 ${row.occurrence_days}일).`,
        evidence_dates: row.evidence_dates,
        memo_ids: row.memo_ids,
      })
  }
  if (!sentences.length) {
    const comparable = rows.some((row) => row.mark !== '비교 불가' && row.mark !== '기록 부족')
    const message = comparable
      ? '기준 구간 대비 증가 표시가 붙은 항목 없음.'
      : '비교할 기록이 부족해 증가 표시를 계산하지 않음.'
    const reportPeriod = { start: baseline?.start ?? current.start, end: asOf }
    sentences.push({
      scope: 'comparison',
      text: `${message} 전체 ${days(current.start, current.end)}일 중 ${coverage}일에 확인된 기록이 있음.`,
      ...coverageSources(reportPeriod),
    })
  } else if (sentences.length < 3) {
    sentences.push({
      scope: 'current',
      text: `이번 구간 전체 ${days(current.start, current.end)}일 중 ${coverage}일에 확인된 기록이 있음.`,
      ...coverageSources(current),
    })
    if (sentences.length < 3)
      sentences.push({
        scope: baseline ? 'baseline' : 'comparison',
        text: baseline
          ? `기준 구간 전체 ${days(baseline.start, baseline.end)}일 중 ${observations(baseline).recorded.size}일에 확인된 기록이 있음.`
          : '비교할 이전 진료 구간이 없어 증가와 새로 나타남 표시를 계산하지 않음.',
        ...coverageSources(baseline),
      })
  }
  const selected = state.memos.filter((memo) => containsDate(current, memo.record_date))
  const hasBaseline = baseline !== null && observations(baseline).recorded.size > 0
  const trendRows = rows
    .filter((row) => row.occurrence_days >= 3 || (row.baseline_occurrence_days ?? 0) >= 3)
    .sort((a, b) => {
      const magnitude = (row: ReportRow) =>
        hasBaseline
          ? Math.abs((row.current_rate ?? 0) - (row.baseline_rate ?? 0))
          : (row.current_rate ?? 0)
      return magnitude(b) - magnitude(a)
    })
    .slice(0, 3)
  return {
    summary_source: 'template',
    trends: trendRows.map((row) => trends(row.type, asOf, periodStart)),
    markers: markers(current, baseline),
    basis_note:
      '비율은 기록일 중 해당 유형이 있었던 날의 비율이며, 주당 환산은 기록일당 평균 횟수를 7일로 환산한 값입니다.',
    patient_alias: state.alias,
    period: current,
    baseline,
    coverage: { recorded_days: coverage, total_days: days(current.start, current.end) },
    baseline_coverage: baseline
      ? {
          recorded_days: observations(baseline).recorded.size,
          total_days: days(baseline.start, baseline.end),
        }
      : null,
    exclusions: {
      pending_memo_ids: selected
        .filter((memo) => memo.status === '확인 대기')
        .map((memo) => memo.memo_id),
      failed_memo_ids: selected
        .filter((memo) => memo.status === '정리 실패')
        .map((memo) => memo.memo_id),
    },
    rows,
    sentences: sentences.slice(0, 5).map((sentence) => ({ types: [], ...sentence })),
    medications: state.medications
      .filter((item) => containsDate(current, item.change_date))
      .sort((a, b) => a.change_date.localeCompare(b.change_date) || a.id - b.id)
      .map((item) => ({ name: item.name, change_type: item.change_type, date: item.change_date })),
    falls,
    questions: state.questions
      .filter((item) => questionInPeriod(item, current))
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id)
      .map((item) => item.text),
    disclaimer: DISCLAIMER,
  }
}
function markers(current: Period, baseline: Period | null): SummaryMarker[] {
  const first = baseline?.start ?? current.start
  return [
    ...state.visits
      .filter(
        (item) =>
          item.status === '완료' && item.visit_date >= first && item.visit_date <= current.end,
      )
      .map((item) => ({ kind: 'visit' as const, date: item.visit_date, label: '진료일' })),
    ...state.medications
      .filter((item) => item.change_date >= first && item.change_date <= current.end)
      .map((item) => ({
        kind: 'medication' as const,
        date: item.change_date,
        label: `${item.name} · ${item.change_type}`,
      })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind))
}
function trends(type: EventType, asOf: string, periodStart?: string | null): Trends {
  const { current, baseline } = periods(asOf, periodStart)
  const weeks: Trends['weeks'] = []
  for (const [period, kind] of [
    [baseline, 'baseline'],
    [current, 'current'],
  ] as const) {
    if (!period) continue
    for (let start = period.start; start <= period.end;) {
      const weekday = new Date(`${start}T12:00:00Z`).getUTCDay()
      const sunday = shift(start, (7 - weekday) % 7)
      const end = sunday < period.end ? sunday : period.end
      const data = observations({ start, end }, type)
      weeks.push({
        start,
        end,
        period: kind,
        rate: data.recorded.size >= 4 ? data.present.size / data.recorded.size : null,
        recorded_days: data.recorded.size,
        event_days: data.present.size,
        low_coverage: data.recorded.size < 4,
      })
      start = shift(end, 1)
    }
  }
  return {
    type,
    period: current,
    baseline,
    weeks,
    markers: markers(current, baseline),
    medications: state.medications
      .filter(
        (item) =>
          item.change_date >= (baseline?.start ?? current.start) && item.change_date <= current.end,
      )
      .sort((a, b) => a.change_date.localeCompare(b.change_date) || a.id - b.id)
      .map((item) => ({ name: item.name, change_type: item.change_type, date: item.change_date })),
  }
}
seed()
export const mockApi: Api = {
  async health(): Promise<Health> {
    return {
      workspace_id: workspaceId,
      ok: true,
      ai_available: false,
      model_name: '화면 개발용 샘플 · 실제 AI 아님',
      allow_lan: false,
      emergency_keywords: EMERGENCY_KEYWORDS,
      emergency_message: EMERGENCY_MESSAGE,
      ai_notice: 'AI가 정리한 내용이에요. 틀린 부분은 고쳐 주세요.',
      disclaimer: DISCLAIMER,
      demo_loaded: demo,
      demo_as_of: demo ? SAMPLE_AS_OF : undefined,
    }
  },
  async createMemo(body) {
    requireText(body.text, 10000, '메모')
    validateDate(body.record_date)
    if (body.record_date > localToday()) throw new Error('미래 날짜는 사용할 수 없어요.')
    if (body.request_id && state.deletedRequests.has(body.request_id))
      throw new Error('삭제한 메모의 저장 요청이에요. 새 메모로 다시 작성해 주세요.')
    if (body.request_id && state.updateRequests.has(body.request_id))
      throw new Error('원문 수정에 사용한 요청 번호예요. 새 저장 요청 번호를 사용해 주세요.')
    if (body.request_id && state.requests[body.request_id]) {
      const existing = memoById(state.requests[body.request_id])
      if (existing.text !== body.text || existing.record_date !== body.record_date)
        throw new Error('같은 저장 요청 번호에 다른 메모가 있어요.')
      return copy(existing)
    }
    const events = sampleEvents(body.text)
    const memo: MemoResult = {
      memo_id: nextId(),
      text: body.text,
      record_date: body.record_date,
      events: events ?? [],
      status: events ? '확인 대기' : '정리 실패',
      model_output: events ? JSON.stringify(events.map(modelFields)) : null,
      emergency: emergency(body.text),
      error: events ? null : `화면 개발용 샘플 모드에서는 이 예시 메모만 정리돼요: ${SAMPLE_TEXT}`,
    }
    state.memos.push(memo)
    state.modelCounts[memo.memo_id] = events?.length ?? 0
    if (body.request_id) state.requests[body.request_id] = memo.memo_id
    await new Promise((resolve) => setTimeout(resolve, 500))
    return copy(memo)
  },
  async updateMemo(id, body) {
    requireText(body.text, 10000, '메모')
    if (body.request_id && state.deletedRequests.has(body.request_id))
      throw new Error('삭제한 메모의 수정 요청이에요. 삭제한 메모는 수정할 수 없어요.')
    const memo = memoById(id)
    if (body.request_id && Object.hasOwn(state.requests, body.request_id))
      throw new Error('메모 작성에 사용한 요청 번호예요. 새 수정 요청 번호를 사용해 주세요.')
    if (body.request_id && state.updateRequests.has(body.request_id)) {
      const previous = state.updateRequests.get(body.request_id)!
      if (previous.memoId !== id || previous.text !== body.text)
        throw new Error('같은 수정 요청 번호에 다른 메모나 원문을 사용할 수 없어요.')
      if (memo.text !== body.text)
        throw new Error('이미 다른 원문으로 수정한 메모예요. 최신 메모를 다시 열어 주세요.')
      return copy(memo)
    }
    const events = sampleEvents(body.text)
    memo.text = body.text
    memo.events = events ?? []
    memo.status = events ? '확인 대기' : '정리 실패'
    memo.model_output = events ? JSON.stringify(events.map(modelFields)) : null
    memo.emergency = emergency(body.text)
    memo.error = events
      ? null
      : `화면 개발용 샘플 모드에서는 이 예시 메모만 정리돼요: ${SAMPLE_TEXT}`
    memo.failure_code = events ? null : 'unknown_error'
    state.modelCounts[id] = events?.length ?? 0
    // Event revisions refer to their original text; a new source starts a new revision history.
    delete state.revisions[id]
    if (body.request_id) state.updateRequests.set(body.request_id, { memoId: id, text: body.text })
    await new Promise((resolve) => setTimeout(resolve, 500))
    // Deletion or another edit may have occurred while the simulated extraction was pending.
    return copy(memoById(id))
  },
  async confirmMemo(id, body) {
    const memo = memoById(id)
    if (memo.status === '정리 실패' && !body.manual)
      throw new Error('직접 정리한 내용을 확인하거나 메모 정리를 다시 시도해 주세요.')
    if (body.events.length > 100) throw new Error('한 메모에는 사건을 100개까지 확인할 수 있어요.')
    const claimed = new Set<number>()
    body.events.forEach((event) => {
      validateEvent(event, memo)
      const index = event.model_event_index
      if (body.manual && index != null)
        throw new Error('수동 확인에는 AI 사건 출처 번호를 지정할 수 없어요.')
      if (index != null) {
        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >= (state.modelCounts[id] ?? 0) ||
          claimed.has(index)
        )
          throw new Error('AI 사건 출처 번호를 확인해 주세요.')
        claimed.add(index)
      }
    })
    const before = copy(memo.events)
    const wasConfirmed = memo.status === '확인 완료'
    const kind: MemoRevision['kind'] = wasConfirmed
      ? '정정'
      : body.manual
        ? '수동 확인'
        : '최초 확인'
    memo.events = copy(body.events)
    memo.status = '확인 완료'
    memo.error = null
    if (!wasConfirmed || JSON.stringify(before) !== JSON.stringify(memo.events))
      (state.revisions[id] ??= []).push({
        id: nextId(),
        created_at: new Date().toISOString(),
        kind,
        before_events: before,
        after_events: copy(memo.events),
      })
    return copy(memo)
  },
  async memoRevisions(id) {
    memoById(id)
    return copy([...(state.revisions[id] ?? [])].reverse())
  },
  async retryMemo(id) {
    const memo = memoById(id)
    if (memo.status !== '정리 실패') throw new Error('정리 실패 메모만 다시 시도할 수 있어요.')
    const events = sampleEvents(memo.text)
    if (events) {
      state.modelCounts[id] = events.length
      memo.events = events
      memo.model_output = JSON.stringify(events.map(modelFields))
      memo.status = '확인 대기'
      memo.error = null
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
    return copy(memo)
  },
  async memos(filters = {}) {
    if (filters.from) validateDate(filters.from)
    if (filters.to) validateDate(filters.to)
    if (filters.from && filters.to && filters.from > filters.to)
      throw new Error('시작일은 종료일보다 늦을 수 없어요.')
    const inRange = (date: string | null) =>
      date !== null &&
      (!filters.from || date >= filters.from) &&
      (!filters.to || date <= filters.to)
    return copy(
      state.memos
        .filter((memo) => inRange(memo.record_date))
        .sort((a, b) => b.record_date.localeCompare(a.record_date) || b.memo_id - a.memo_id),
    )
  },
  async deleteMemo(id) {
    memoById(id)
    // Events belong to the memo. Removing it also removes every report contribution.
    state.memos = state.memos.filter((memo) => memo.memo_id !== id)
    delete state.revisions[id]
    delete state.modelCounts[id]
    for (const [requestId, memoId] of Object.entries(state.requests)) {
      if (memoId !== id) continue
      state.deletedRequests.add(requestId)
      delete state.requests[requestId]
    }
    for (const [requestId, request] of state.updateRequests) {
      if (request.memoId !== id) continue
      state.deletedRequests.add(requestId)
      state.updateRequests.delete(requestId)
    }
  },
  async addEvent({ memo_id, ...event }) {
    const memo = memoById(memo_id)
    if (memo.status !== '확인 완료') throw new Error('확인 완료한 메모에 사건을 추가해 주세요.')
    validateEvent(event, memo)
    if (event.model_event_index != null)
      throw new Error('직접 추가한 사건은 AI 사건 출처 번호를 가질 수 없어요.')
    event.model_event_index = null
    const existing = memo.events.some(
      (item) =>
        item.type === event.type &&
        item.status === event.status &&
        item.time_expr === event.time_expr &&
        item.count === event.count &&
        item.evidence === event.evidence,
    )
    if (!existing) {
      const before = copy(memo.events)
      memo.events.push(copy(event))
      ;(state.revisions[memo_id] ??= []).push({
        id: nextId(),
        created_at: new Date().toISOString(),
        kind: '직접 추가',
        before_events: before,
        after_events: copy(memo.events),
      })
    }
    return copy(memo)
  },
  async visits() {
    return copy(
      [...state.visits].sort((a, b) => a.visit_date.localeCompare(b.visit_date) || a.id - b.id),
    )
  },
  async addVisit(body) {
    validateDate(body.visit_date)
    if (state.visits.some((item) => item.visit_date === body.visit_date))
      throw new Error('이미 등록된 진료일이에요.')
    const status = body.status ?? '예정'
    if (status === '완료' && body.visit_date > localToday())
      throw new Error('미래 진료는 완료할 수 없어요.')
    const value: Visit = { id: nextId(), visit_date: body.visit_date, status }
    state.visits.push(value)
    return copy(value)
  },
  async updateVisit(id, body) {
    const visit = state.visits.find((item) => item.id === id)
    if (!visit) throw new Error('진료일을 찾을 수 없어요.')
    if (body.status === '완료' && visit.visit_date > localToday())
      throw new Error('미래 진료는 완료할 수 없어요.')
    visit.status = body.status
    return copy(visit)
  },
  async deleteVisit(id) {
    if (!state.visits.some((item) => item.id === id)) throw new Error('항목을 찾을 수 없어요.')
    state.visits = state.visits.filter((item) => item.id !== id)
  },
  async medications() {
    return copy(
      [...state.medications].sort(
        (a, b) => a.change_date.localeCompare(b.change_date) || a.id - b.id,
      ),
    )
  },
  async addMedication(body) {
    requireText(body.name, 100, '약 이름')
    validateDate(body.change_date)
    if (!['시작', '증량', '감량', '중단'].includes(body.change_type))
      throw new Error('약 변경 내용을 확인해 주세요.')
    const existing = state.medications.find(
      (item) =>
        item.name === body.name.trim() &&
        item.change_type === body.change_type &&
        item.change_date === body.change_date,
    )
    if (existing) return copy(existing)
    const value = { id: nextId(), ...body, name: body.name.trim() }
    state.medications.push(value)
    return copy(value)
  },
  async deleteMedication(id) {
    if (!state.medications.some((item) => item.id === id)) throw new Error('항목을 찾을 수 없어요.')
    state.medications = state.medications.filter((item) => item.id !== id)
  },
  async questions() {
    return copy(
      [...state.questions].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id),
    )
  },
  async addQuestion(body) {
    requireText(body.text, 1000, '전할 말')
    if (Boolean(body.period_start) !== Boolean(body.period_end))
      throw new Error('시작 날짜와 마지막 날짜를 함께 선택해 주세요.')
    if (body.period_start && body.period_end) {
      validateDate(body.period_start)
      validateDate(body.period_end)
      if (body.period_start > body.period_end) throw new Error('시작 날짜를 확인해 주세요.')
    }
    const existing = state.questions.find(
      (item) =>
        item.text === body.text &&
        item.created_at.slice(0, 10) === localToday() &&
        (body.period_start
          ? item.period_start === body.period_start && item.period_end === body.period_end
          : !item.period_start),
    )
    if (existing) return copy(existing)
    const value: Question = { id: nextId(), ...body, created_at: localToday() }
    state.questions.push(value)
    return copy(value)
  },
  async deleteQuestion(id) {
    if (!state.questions.some((item) => item.id === id)) throw new Error('항목을 찾을 수 없어요.')
    state.questions = state.questions.filter((item) => item.id !== id)
  },
  async summary(asOf = demo ? SAMPLE_AS_OF : localToday(), periodStart) {
    return copy(summary(asOf, periodStart))
  },
  async summaryPeriod(asOf = demo ? SAMPLE_AS_OF : localToday(), periodStart) {
    const { current, baseline } = periods(asOf, periodStart)
    return copy({ period: current, baseline })
  },
  async trends(type, asOf = demo ? SAMPLE_AS_OF : localToday(), periodStart) {
    return copy(trends(type, asOf, periodStart))
  },
  async patient() {
    return { alias: state.alias }
  },
  async savePatient(body) {
    requireText(body.alias, 50, '가명')
    state.alias = body.alias.trim()
    return { alias: state.alias }
  },
  async loadDemo() {
    if (!demo) {
      backup = copy(state)
      if (savedDemo) state = copy(savedDemo)
      else seed()
    }
    demo = true
    workspaceId = crypto.randomUUID()
    return { ok: true, workspace_id: workspaceId }
  },
  async exitDemo() {
    if (demo) {
      savedDemo = copy(state)
      if (backup) state = backup
      backup = null
    }
    demo = false
    workspaceId = crypto.randomUUID()
    return { ok: true, workspace_id: workspaceId }
  },
}

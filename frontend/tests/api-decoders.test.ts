// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/api/client'
import {
  decoders,
  wireEvent,
  wireEventType,
  wireMedicationChange,
  wireVisitStatus,
} from '../src/api/decoders'
import { EVENT_TYPES } from '../src/api/types'

const event = () => ({
  type: 'night_waking',
  status: 'present',
  time_expr: '밤',
  count: 2,
  evidence: '밤에 두 번 깨셨다.',
  model_event_index: 0,
})
const memo = () => ({
  memo_id: 3,
  status: 'pending',
  emergency: { matched: false, message: null },
  events: [event()],
  text: '밤에 두 번 깨셨다.',
  record_date: '2026-09-27',
  error: null,
  model_output: null,
  failure_code: null,
})
const trends = () => ({
  type: 'night_waking',
  period: { start: '2026-09-01', end: '2026-09-27' },
  baseline: null,
  markers: [{ kind: 'medication', date: '2026-09-10', label: '약 증량' }],
  weeks: [
    {
      start: '2026-09-21',
      end: '2026-09-27',
      period: 'current',
      rate: 0.5,
      recorded_days: 6,
      event_days: 3,
      low_coverage: false,
    },
  ],
  medications: [{ name: '등록한 약', change_type: 'increase', date: '2026-09-10' }],
})
const summary = () => ({
  patient_alias: '돌봄 대상',
  period: { start: '2026-09-01', end: '2026-09-27' },
  baseline: { start: '2026-08-01', end: '2026-08-31' },
  coverage: { recorded_days: 20, total_days: 27 },
  baseline_coverage: { recorded_days: 20, total_days: 31 },
  exclusions: {
    pending_memo_ids: [3],
    failed_memo_ids: [],
  },
  summary_source: 'template',
  basis_note: '기록 기준',
  trends: [trends()],
  markers: [{ kind: 'visit', date: '2026-09-01', label: '진료' }],
  rows: [
    {
      type: 'night_waking',
      baseline_rate: 0.1,
      current_rate: 0.5,
      weekly_count: 3.5,
      mark: 'increase',
      evidence_dates: ['2026-09-27'],
      memo_ids: [3],
      occurrence_days: 10,
      recorded_days: 20,
      mentioned_days: 10,
      absent_days: 0,
      unmentioned_days: 10,
      baseline_recorded_days: 20,
      baseline_occurrence_days: 2,
      baseline_mentioned_days: 2,
      baseline_absent_days: 0,
      baseline_unmentioned_days: 18,
    },
  ],
  sentences: [
    {
      scope: 'comparison',
      types: ['night_waking'],
      text: '밤에 깨는 기록이 늘어남.',
      evidence_dates: ['2026-09-27'],
      memo_ids: [3],
    },
  ],
  medications: [{ name: '등록한 약', change_type: 'increase', date: '2026-09-10' }],
  falls: ['2026-09-20'],
  questions: ['진료 시 확인할 내용'],
  disclaimer: '보호자 기록',
})

function invalid(callback: () => unknown, field: string) {
  expect(callback).toThrowError(
    expect.objectContaining({
      name: 'ApiError',
      status: 502,
      code: 'invalid_response',
      message: expect.stringContaining(field),
    }),
  )
}

describe('normalized UI responses', () => {
  it('allows minimal health without inventing a workspace or AI availability', () => {
    expect(decoders.health({ ok: true })).toMatchObject({
      ok: true,
      workspace_id: '',
      ai_available: null,
      model_name: '',
      emergency_keywords: [],
      emergency_message: '',
      ai_notice: '',
      disclaimer: '',
    })
    expect(
      decoders.health({ ok: false, ai_available: false, workspace_id: 'server-a' }),
    ).toMatchObject({ ok: false, ai_available: false, workspace_id: 'server-a' })
    invalid(() => decoders.health({ ai_available: true }), 'health.ok')
    invalid(
      () => decoders.health({ ok: true, emergency_keywords: [7] }),
      'health.emergency_keywords[0]',
    )
  })

  it.each([
    ['night_waking', '야간 각성'],
    ['wandering_exit', '배회·출입문 시도'],
    ['agitation', '초조·공격'],
    ['irritability', '과민·짜증'],
    ['anxiety', '불안'],
    ['low_mood_apathy', '우울·무기력'],
    ['delusion', '망상'],
    ['hallucination', '환각'],
    ['reduced_intake', '식사량 감소'],
    ['medication_refusal', '복약 거부'],
    ['confusion', '사람·장소 혼동'],
    ['fall', '낙상'],
  ])('normalizes symptom code %s and encodes it back without editing evidence', (code, label) => {
    const input = memo()
    input.events[0].type = code
    const result = decoders.memo(input).events[0]
    expect(result.type).toBe(label)
    expect(wireEventType(result.type)).toBe(code)
    expect(wireEvent(result)).toEqual({ ...event(), type: code })
  })

  it('accepts Korean labels and preserves absence and event index', () => {
    const input = {
      ...memo(),
      status: '확인 완료',
      events: [
        {
          ...event(),
          type: '불안',
          status: '없었음',
          model_event_index: null,
        },
      ],
    }
    expect(decoders.memo(input)).toEqual(input)
    expect(wireEvent(decoders.memo(input).events[0])).toMatchObject({
      type: 'anxiety',
      status: 'absent',
      model_event_index: null,
    })
    expect(EVENT_TYPES.map(wireEventType)).toHaveLength(12)
  })

  it.each([
    ['pending', '확인 대기'],
    ['confirmed', '확인 완료'],
    ['failed', '정리 실패'],
  ])('normalizes memo status %s', (code, label) => {
    expect(decoders.memos([{ ...memo(), status: code }])[0].status).toBe(label)
  })

  it.each([
    ['scheduled', '예정'],
    ['completed', '완료'],
  ] as const)('normalizes and encodes visit %s', (code, label) => {
    expect(decoders.visits([{ id: 1, visit_date: '2026-10-01', status: code }])[0].status).toBe(
      label,
    )
    expect(wireVisitStatus(label)).toBe(code)
  })

  it.each([
    ['start', '시작'],
    ['increase', '증량'],
    ['decrease', '감량'],
    ['stop', '중단'],
  ] as const)('normalizes and encodes medication change %s', (code, label) => {
    const result = decoders.medications([
      { id: 1, name: '등록한 약', change_date: '2026-09-27', change_type: code },
    ])[0]
    expect(result.change_type).toBe(label)
    expect(wireMedicationChange(label)).toBe(code)
  })

  it('decodes revisions, question dates, patient and workspace metadata', () => {
    expect(
      decoders.revisions([
        {
          id: 2,
          created_at: '2026-09-27T12:30:10.123456+09:00',
          kind: '정정',
          before_events: [],
          after_events: [event()],
        },
      ])[0].after_events[0].type,
    ).toBe('야간 각성')
    expect(
      decoders.questions([
        {
          id: 1,
          text: '질문',
          created_at: '2026-09-27',
          period_start: null,
          period_end: '2026-09-27',
        },
      ])[0],
    ).toMatchObject({ period_start: null, period_end: '2026-09-27' })
    expect(decoders.patient({ alias: '보호자 지정 이름' })).toEqual({ alias: '보호자 지정 이름' })
    expect(decoders.workspace({ ok: true, workspace_id: 'a' })).toEqual({
      ok: true,
      workspace_id: 'a',
    })
    expect(decoders.empty(undefined)).toBeUndefined()
    expect(decoders.empty(null)).toBeUndefined()
  })

  it('validates nested reports and keeps optional data used by the screens', () => {
    const result = decoders.summary(summary())
    expect(result.rows[0]).toMatchObject({
      type: '야간 각성',
      mark: '증가',
      weekly_count: 3.5,
      baseline_unmentioned_days: 18,
    })
    expect(result.sentences[0]).toMatchObject({
      types: ['야간 각성'],
      scope: 'comparison',
      memo_ids: [3],
    })
    expect(result.medications[0].change_type).toBe('증량')
    expect(result.trends?.[0].weeks[0].rate).toBe(0.5)
    expect(result.baseline_coverage?.total_days).toBe(31)
    expect(result.exclusions?.pending_memo_ids).toEqual([3])
  })

  it.each([
    ['increase', '증가'],
    ['new', '새로 나타남'],
    ['not_comparable', '비교 불가'],
    ['insufficient', '기록 부족'],
  ])('normalizes comparison mark %s', (code, label) => {
    const data = summary()
    data.rows[0].mark = code
    expect(decoders.summary(data).rows[0].mark).toBe(label)
  })

  it('keeps zero-based event indexes and empty report totals valid', () => {
    expect(decoders.memo(memo()).events[0].model_event_index).toBe(0)
    const data = summary()
    const report = decoders.summary({
      ...data,
      coverage: { recorded_days: 0, total_days: 0 },
      rows: [
        {
          ...data.rows[0],
          occurrence_days: 0,
          recorded_days: 0,
          weekly_count: 0,
          baseline_rate: 0,
          current_rate: 0,
        },
      ],
    })
    expect(report.coverage).toEqual({ recorded_days: 0, total_days: 0 })
    expect(report.rows[0]).toMatchObject({
      occurrence_days: 0,
      recorded_days: 0,
      weekly_count: 0,
      baseline_rate: 0,
      current_rate: 0,
    })
  })

  it('requires a positive count even for an absent observation', () => {
    const input = { ...memo(), events: [{ ...event(), status: 'absent', count: 1 }] }
    expect(decoders.memo(input).events[0]).toMatchObject({ status: '없었음', count: 1 })
    invalid(
      () => decoders.memo({ ...input, events: [{ ...input.events[0], count: 0 }] }),
      'memo.events[0].count',
    )
  })

  it('preserves explicit nulls without filling clinical data', () => {
    const data = summary()
    const result = decoders.summary({
      ...data,
      baseline: null,
      baseline_coverage: null,
      rows: [
        {
          ...data.rows[0],
          baseline_rate: null,
          current_rate: null,
          weekly_count: null,
          mark: null,
        },
      ],
    })
    expect(result.baseline).toBeNull()
    expect(result.rows[0]).toMatchObject({
      baseline_rate: null,
      current_rate: null,
      weekly_count: null,
      mark: null,
    })
  })
})

describe('malformed responses stop at the API boundary', () => {
  it('rejects raw AI events, job acceptance, and unhandled envelopes as saved memos', () => {
    for (const input of [
      { events: [event()] },
      { job_id: 'task-1', status: 'queued' },
      { data: memo() },
    ]) {
      invalid(() => decoders.memo(input), 'memo.')
    }
    invalid(() => decoders.memos({ data: [] }), 'memos')
  })

  it.each([
    ['count', 0],
    ['count', -1],
    ['count', 1.5],
    ['count', Number.POSITIVE_INFINITY],
    ['count', '2'],
    ['model_event_index', -1],
    ['type', 'unknown_symptom'],
    ['type', 'toString'],
    ['status', 'unknown'],
    ['evidence', null],
    ['time_expr', 3],
  ])('rejects event %s=%s', (field, value) => {
    const input = { ...memo(), events: [{ ...event(), [field]: value }] }
    invalid(() => decoders.memo(input), `memo.events[0].${field}`)
  })

  it('requires one selected record date and accepts actual leap days', () => {
    expect(decoders.memo({ ...memo(), record_date: '2024-02-29' }).record_date).toBe('2024-02-29')
    const input: Record<string, unknown> = memo()
    delete input.record_date
    invalid(() => decoders.memo(input), 'memo.record_date')
  })

  it.each(['2026-02-29', '2026-9-01', '2026-04-31', '0000-01-01', null])(
    'rejects invalid selected record date %s',
    (recordDate) => {
      invalid(() => decoders.memo({ ...memo(), record_date: recordDate }), 'memo.record_date')
    },
  )

  it('keeps the selected day and omits independently supplied event and creation dates', () => {
    const result = decoders.memo({
      ...memo(),
      record_date: '2026-09-23',
      created_at: '2026-09-28T08:00:00Z',
      events: [{ ...event(), time_expr: '어젯밤', event_date: '2026-09-22', date_unknown: true }],
    })
    expect(result.record_date).toBe('2026-09-23')
    expect(result).not.toHaveProperty('created_at')
    expect(result.events[0]).not.toHaveProperty('event_date')
    expect(result.events[0]).not.toHaveProperty('date_unknown')
    expect(wireEvent(result.events[0])).not.toHaveProperty('event_date')
    expect(wireEvent(result.events[0]).time_expr).toBe('어젯밤')
  })

  it.each([0, -1, 1.1, Number.NaN, '3', Number.MAX_SAFE_INTEGER + 1])(
    'rejects memo ID %s',
    (memoId) => {
      invalid(() => decoders.memo({ ...memo(), memo_id: memoId }), 'memo.memo_id')
    },
  )

  it.each([-0.1, 10, Number.POSITIVE_INFINITY, '0.1'])(
    'rejects percentages and invalid fractions %s',
    (value) => {
      const data = summary()
      invalid(
        () => decoders.summary({ ...data, rows: [{ ...data.rows[0], current_rate: value }] }),
        'summary.rows[0].current_rate',
      )
    },
  )

  it('checks nested summary references, exclusion IDs, chart weeks and marker dates', () => {
    const data = summary()
    invalid(
      () =>
        decoders.summary({ ...data, sentences: [{ ...data.sentences[0], types: ['unexpected'] }] }),
      'summary.sentences[0].types[0]',
    )
    invalid(
      () =>
        decoders.summary({ ...data, exclusions: { ...data.exclusions, failed_memo_ids: [-1] } }),
      'summary.exclusions.failed_memo_ids[0]',
    )
    invalid(
      () => decoders.summary({ ...data, markers: [{ ...data.markers[0], date: '2026-13-01' }] }),
      'summary.markers[0].date',
    )
    invalid(
      () => decoders.summary({ ...data, coverage: { recorded_days: 1.5, total_days: 27 } }),
      'summary.coverage.recorded_days',
    )
    invalid(
      () => decoders.trends({ ...trends(), weeks: [{ ...trends().weeks[0], rate: 50 }] }),
      'trends.weeks[0].rate',
    )
    invalid(
      () =>
        decoders.trends({ ...trends(), weeks: [{ ...trends().weeks[0], low_coverage: 'yes' }] }),
      'trends.weeks[0].low_coverage',
    )
    invalid(
      () => decoders.summary({ ...data, period: { start: '2026-09-27', end: '2026-09-01' } }),
      'summary.period',
    )
  })

  it('rejects invalid optional values and missing required strings', () => {
    invalid(() => decoders.memo({ ...memo(), failure_code: 'mystery' }), 'memo.failure_code')
    invalid(
      () => decoders.question({ id: 1, text: '질문', created_at: '2026-02-30T12:00:00Z' }),
      'question.created_at',
    )
    invalid(
      () => decoders.question({ id: 1, text: '질문', created_at: '2026-09-27T25:00:00Z' }),
      'question.created_at',
    )
    invalid(
      () => decoders.question({ id: 1, text: '질문', created_at: '2026-09-27', period_end: 3 }),
      'question.period_end',
    )
    invalid(() => decoders.patient({}), 'patient.alias')
    invalid(() => decoders.workspace({ ok: true, workspace_id: '' }), 'workspace.workspace_id')
    invalid(() => decoders.empty({ ok: true }), 'empty')
    expect(() => decoders.summary(null)).toThrow(ApiError)
  })
})

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../src/api'
let mockApi: Api
import type { EventCard, EventType, Summary, SummaryRow } from '../src/api/types'

const sample = '새벽 3시쯤 깨서 현관문 열려고 하심. 저녁은 반 공기.'
type EvidenceRow = SummaryRow & {
  current_evidence_dates: string[]
  current_memo_ids: number[]
  occurrence_dates: string[]
}
const rowOf = (report: Summary, type: EventType) =>
  report.rows.find((row) => row.type === type)! as EvidenceRow

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-27T12:00:00+09:00'))
  vi.resetModules()
  mockApi = (await import('../src/api/mock/mockApi')).mockApi
  await mockApi.loadDemo()
})
afterEach(() => vi.useRealTimers())

async function create(recordDate: string, text = sample) {
  const request = mockApi.createMemo({ text, record_date: recordDate })
  await vi.advanceTimersByTimeAsync(500)
  return request
}

async function confirmed(
  recordDate: string,
  type: EventType,
  status: EventCard['status'] = '있었음',
) {
  const memo = await create(recordDate)
  return mockApi.confirmMemo(memo.memo_id, {
    events: [{ ...memo.events[0], type, status }],
  })
}

describe('mock report follows the API statistics contract', () => {
  it('uses the display rounding for half percentages while preserving calculated rates', async () => {
    await mockApi.addVisit({ visit_date: '2026-01-01', status: '완료' })
    await mockApi.addVisit({ visit_date: '2026-02-02', status: '완료' })
    for (const [start, occurred] of [
      ['2026-01-01', 4],
      ['2026-02-02', 20],
    ] as const) {
      for (let day = 0; day < 32; day++) {
        const date = new Date(Date.parse(`${start}T12:00:00Z`) + day * 86400000)
          .toISOString()
          .slice(0, 10)
        const memo = await create(date)
        await mockApi.confirmMemo(memo.memo_id, {
          events: day < occurred ? [{ ...memo.events[0], type: '불안' }] : [],
        })
      }
    }
    const report = await mockApi.summary('2026-03-05')
    const row = rowOf(report, '불안')
    expect(row.baseline_rate).toBe(0.125)
    expect(row.current_rate).toBe(0.625)
    expect(row.mark).toBe('증가')
    expect(report.sentences[0].text).toContain('기준 구간 13%에서 이번 구간 63%')
  })

  it('keeps an appointment pending on its day and preserves a pinned report after explicit completion', async () => {
    vi.setSystemTime(new Date('2026-10-05T09:00:00+09:00'))
    const scheduled = (await mockApi.visits()).find((visit) => visit.visit_date === '2026-10-05')!
    expect(scheduled.status).toBe('예정')
    const before = await mockApi.summary('2026-10-05')
    expect(before.period.start).toBe('2026-08-20')
    expect(before.questions).toHaveLength(3)
    await mockApi.updateVisit(scheduled.id, { status: '완료' })
    expect((await mockApi.summary('2026-10-05')).period.start).toBe('2026-10-05')
    const pinned = await mockApi.summary('2026-10-05', '2026-08-20')
    expect(pinned.questions).toEqual(before.questions)
    expect(pinned.medications).toEqual(before.medications)
    expect((await mockApi.trends('야간 각성', '2026-10-05', '2026-08-20')).period).toEqual(
      pinned.period,
    )
  })

  it('exposes missing records and disjoint observation counts without treating mentions as all recorded days', async () => {
    const report = await mockApi.summary('2026-09-27')
    expect(report.exclusions?.pending_memo_ids).toHaveLength(4)
    expect(report.exclusions?.failed_memo_ids).toHaveLength(1)
    expect(Object.keys(report.exclusions!)).toEqual(['pending_memo_ids', 'failed_memo_ids'])
    expect(report.baseline_coverage).toEqual({ recorded_days: 80, total_days: 91 })
    const row = rowOf(report, '야간 각성')
    expect(row.occurrence_days + row.absent_days! + row.unmentioned_days!).toBe(row.recorded_days)
    expect(row.current_rate).toBe(13 / 24)
    expect(row.unmentioned_days).toBe(10)
  })

  it('supports manual recovery and preserves both recovery and later correction snapshots', async () => {
    const failed = (await mockApi.memos()).find((memo) => memo.status === '정리 실패')!
    const event: EventCard = {
      type: '복약 거부',
      status: '있었음',
      time_expr: null,
      count: 1,
      evidence: failed.text,
      model_event_index: null,
    }
    await expect(mockApi.confirmMemo(failed.memo_id, { events: [event] })).rejects.toThrow()
    await mockApi.confirmMemo(failed.memo_id, { events: [event], manual: true })
    await mockApi.confirmMemo(failed.memo_id, { events: [{ ...event, count: 2 }] })
    const revisions = await mockApi.memoRevisions(failed.memo_id)
    expect(revisions.map((item) => item.kind)).toEqual(['정정', '수동 확인'])
    expect(revisions[0].before_events[0].count).toBe(1)
    expect(revisions[0].after_events[0].count).toBe(2)
    expect(
      (await mockApi.memos()).find((item) => item.memo_id === failed.memo_id)?.events,
    ).toHaveLength(1)
  })

  it('uses only the selected record date for events, evidence and list filters', async () => {
    await create('2026-01-01', '샘플 정리 실패 원문')
    await create('2026-01-02')
    const memo = await create('2026-01-08')
    expect((await mockApi.summary('2026-01-10')).coverage.recorded_days).toBe(0)
    await mockApi.confirmMemo(memo.memo_id, {
      events: [
        { ...memo.events[0], count: 3 },
        { ...memo.events[1], count: 2 },
      ],
    })
    const report = await mockApi.summary('2026-01-10')
    expect(report.period).toEqual({ start: '2026-01-08', end: '2026-01-10' })
    expect(report.coverage).toEqual({ recorded_days: 1, total_days: 3 })
    expect(rowOf(report, '야간 각성').current_rate).toBe(1)
    expect(rowOf(report, '야간 각성').evidence_dates).toEqual(['2026-01-08'])
    expect(rowOf(report, '배회·출입문 시도').occurrence_days).toBe(1)
    expect(rowOf(report, '배회·출입문 시도').evidence_dates).toEqual(['2026-01-08'])
    expect(
      (await mockApi.memos({ from: '2026-01-08', to: '2026-01-08' })).map((item) => item.memo_id),
    ).toContain(memo.memo_id)
    expect(
      (await mockApi.memos({ from: '2026-01-10', to: '2026-01-10' })).map((item) => item.memo_id),
    ).not.toContain(memo.memo_id)
    expect(report.exclusions).toEqual({ pending_memo_ids: [], failed_memo_ids: [] })
  })

  it('keeps both comparison periods in row evidence but only current presence in new-occurrence sentences', async () => {
    await mockApi.addVisit({ visit_date: '2026-01-01', status: '완료' })
    await mockApi.addVisit({ visit_date: '2026-02-01', status: '완료' })
    for (let day = 1; day <= 14; day++) {
      const memo = await create(`2026-02-${String(day).padStart(2, '0')}`)
      await mockApi.confirmMemo(memo.memo_id, { events: [] })
    }
    const baseline = await confirmed('2026-01-31', '불안', '없었음')
    const present = await confirmed('2026-02-10', '불안')
    const absent = await confirmed('2026-02-11', '불안', '없었음')
    const report = await mockApi.summary('2026-02-28')
    const row = rowOf(report, '불안')
    expect(row.mark).toBe('새로 나타남')
    expect(row.evidence_dates).toEqual(['2026-01-31', '2026-02-10', '2026-02-11'])
    expect(row.memo_ids).toEqual([baseline.memo_id, present.memo_id, absent.memo_id])
    expect(row.current_evidence_dates).toEqual(['2026-02-10'])
    expect(row.current_memo_ids).toEqual([present.memo_id])
    const sentence = report.sentences.find((item) => item.text.startsWith('불안:'))!
    expect(sentence.text).toBe(
      '불안: 기준 구간에는 기록이 없었고 이번 구간 2026-02-10에 처음 기록됨 (총 1일).',
    )
    expect(sentence.evidence_dates).toEqual(['2026-02-10'])
    expect(sentence.memo_ids).toEqual([present.memo_id])
  })

  it('lists falls and evidence using the same selected record dates', async () => {
    await mockApi.addVisit({ visit_date: '2026-01-01', status: '완료' })
    await mockApi.addVisit({ visit_date: '2026-02-01', status: '완료' })
    const baseline = await confirmed('2026-01-31', '낙상')
    const present = await confirmed('2026-02-22', '낙상')
    const absent = await confirmed('2026-02-23', '낙상', '없었음')
    const report = await mockApi.summary('2026-02-28')
    expect(report.falls).toEqual(['2026-02-22'])
    const sentence = report.sentences.find((item) => item.text.startsWith('낙상:'))!
    expect(sentence.memo_ids).toEqual([present.memo_id])
    expect(sentence.memo_ids).not.toContain(baseline.memo_id)
    expect(sentence.memo_ids).not.toContain(absent.memo_id)
    expect(sentence.evidence_dates).toEqual(['2026-02-22'])
    expect(rowOf(report, '낙상').memo_ids).toEqual([
      baseline.memo_id,
      present.memo_id,
      absent.memo_id,
    ])
  })

  it('cites both periods for an increase and suppresses weekly counts when comparison is unavailable', async () => {
    await mockApi.addVisit({ visit_date: '2026-01-01', status: '완료' })
    await mockApi.addVisit({ visit_date: '2026-02-01', status: '완료' })
    await confirmed('2026-01-01', '불안')
    for (let day = 2; day <= 10; day++) {
      const memo = await create(`2026-01-${String(day).padStart(2, '0')}`)
      await mockApi.confirmMemo(memo.memo_id, { events: [] })
    }
    for (let day = 1; day <= 14; day++) {
      const date = `2026-02-${String(day).padStart(2, '0')}`
      await confirmed(date, '불안')
    }
    const report = await mockApi.summary('2026-02-14')
    const increase = rowOf(report, '불안')
    expect(increase.mark).toBe('증가')
    expect(increase.baseline_rate).toBe(0.1)
    expect(increase.current_rate).toBe(1)
    expect(increase.evidence_dates.some((date) => date < report.period.start)).toBe(true)
    expect(increase.evidence_dates.some((date) => date >= report.period.start)).toBe(true)
    const sentence = report.sentences.find((item) => item.text.startsWith('불안:'))!
    expect(sentence.evidence_dates).toEqual(increase.evidence_dates)
    expect(sentence.memo_ids).toEqual(increase.memo_ids)
    expect(increase.weekly_count).toBe(7)
    const insufficient = await mockApi.summary('2026-02-02')
    expect(
      insufficient.rows.every((row) => row.mark === '기록 부족' && row.weekly_count === null),
    ).toBe(true)
    const firstVisit = await mockApi.summary('2026-01-10')
    expect(
      firstVisit.rows.every((row) => row.mark === '비교 불가' && row.weekly_count === null),
    ).toBe(true)
  })

  it('uses Monday-Sunday weeks clipped at visit boundaries and flags fewer than four recorded days', async () => {
    const graph = await mockApi.trends('야간 각성', '2026-09-26')
    const baseline = graph.weeks.filter((week) => week.period === 'baseline')
    const current = graph.weeks.filter((week) => week.period === 'current')
    expect(baseline[0]).toMatchObject({ start: '2026-05-21', end: '2026-05-24' })
    expect(baseline[1].start).toBe('2026-05-25')
    expect(baseline.at(-1)?.end).toBe('2026-08-19')
    expect(current[0]).toMatchObject({ start: '2026-08-20', end: '2026-08-23' })
    expect(current.some((week) => week.low_coverage)).toBe(true)
    expect(current.at(-1)?.end).toBe('2026-09-26')
    for (const week of graph.weeks) {
      expect(week.low_coverage).toBe(week.recorded_days < 4)
      if (week.low_coverage) expect(week.rate).toBeNull()
    }
  })
})

it('설명 문장의 근거도 선택한 기록 날짜를 사용하고 기간 밖 기록은 제외한다', async () => {
  await create('2026-01-01') // Pending must never become evidence.
  const selected = await confirmed('2026-01-03', '불안')
  const outside = await confirmed('2026-01-11', '불안')
  const report = await mockApi.summary('2026-01-05')
  expect(report.sentences).toHaveLength(1)
  expect(report.sentences[0].memo_ids).toEqual([selected.memo_id])
  expect(report.sentences[0].evidence_dates).toEqual(['2026-01-03'])
  expect(report.sentences[0].memo_ids).not.toContain(outside.memo_id)
})

it('낙상만 새로 나타난 구간에는 표시 없음 문장을 넣지 않고 현재·기준 커버리지 근거를 분리한다', async () => {
  await mockApi.addVisit({ visit_date: '2026-01-01', status: '완료' })
  await mockApi.addVisit({ visit_date: '2026-02-01', status: '완료' })
  const baseline = await create('2026-01-20')
  await mockApi.confirmMemo(baseline.memo_id, { events: [] })
  const currentIds: number[] = []
  for (let day = 1; day <= 14; day++) {
    const date = `2026-02-${String(day).padStart(2, '0')}`
    currentIds.push((await confirmed(date, '낙상')).memo_id)
  }
  const report = await mockApi.summary('2026-02-14')
  expect(rowOf(report, '낙상').mark).toBe('새로 나타남')
  expect(report.sentences.map((item) => item.text)).toEqual([
    '낙상: 2026-02-01, 2026-02-02, 2026-02-03 외 11일에 기록됨.',
    '이번 구간 전체 14일 중 14일에 확인된 기록이 있음.',
    '기준 구간 전체 31일 중 1일에 확인된 기록이 있음.',
  ])
  expect(report.sentences.map((item) => item.scope)).toEqual(['current', 'current', 'baseline'])
  expect(report.sentences[0].memo_ids).toEqual(currentIds)
  expect(report.sentences[1].memo_ids).toEqual(currentIds)
  expect(report.sentences[2].memo_ids).toEqual([baseline.memo_id])
  expect(report.sentences[2].evidence_dates).toEqual(['2026-01-20'])
})

it('표시가 여섯 개면 낙상·새로 나타남·비율 차이가 큰 증가 순으로 다섯 문장을 고른다', async () => {
  await mockApi.addVisit({ visit_date: '2026-01-01', status: '완료' })
  await mockApi.addVisit({ visit_date: '2026-02-01', status: '완료' })
  for (let day = 1; day <= 31; day++) {
    const memo = await create(`2026-01-${String(day).padStart(2, '0')}`)
    const events: EventCard[] = day <= 3 ? [{ ...memo.events[0] }] : []
    if (day === 1) events.push({ ...memo.events[1], type: '불안' })
    await mockApi.confirmMemo(memo.memo_id, { events })
  }
  for (let day = 1; day <= 14; day++) {
    const memo = await create(`2026-02-${String(day).padStart(2, '0')}`)
    const events: EventCard[] = [{ ...memo.events[0] }]
    for (const [type, limit] of [
      ['불안', 7],
      ['낙상', 1],
      ['환각', 2],
      ['배회·출입문 시도', 3],
      ['복약 거부', 1],
    ] as const) {
      if (day <= limit)
        events.push({
          ...memo.events[0],
          type,
          model_event_index: null,
        })
    }
    await mockApi.confirmMemo(memo.memo_id, { events })
  }
  const report = await mockApi.summary('2026-02-14')
  expect(rowOf(report, '불안').mark).toBe('증가')
  expect(rowOf(report, '야간 각성').mark).toBe('증가')
  expect(report.sentences.map((item) => item.text.split(':')[0])).toEqual([
    '낙상',
    '배회·출입문 시도',
    '환각',
    '복약 거부',
    '야간 각성',
  ])
  for (const item of report.sentences) {
    expect(item.memo_ids!.length).toBeGreaterThan(0)
    expect(item.evidence_dates.length).toBeGreaterThan(0)
  }
})

it('mock uses templates and selects the three largest eligible absolute changes', async () => {
  const report = await mockApi.summary('2026-09-27', undefined, true)
  expect(report.summary_source).toBe('template')
  expect(report.sentences.every((sentence) => Array.isArray(sentence.types))).toBe(true)
  const eligible = report.rows
    .filter((row) => row.occurrence_days >= 3 || (row.baseline_occurrence_days ?? 0) >= 3)
    .sort(
      (a, b) =>
        Math.abs((b.current_rate ?? 0) - (b.baseline_rate ?? 0)) -
        Math.abs((a.current_rate ?? 0) - (a.baseline_rate ?? 0)),
    )
    .slice(0, 3)
    .map((row) => row.type)
  expect(report.trends?.map((trend) => trend.type)).toEqual(eligible)
  expect(report.trends).toHaveLength(3)
  expect(report.markers).toContainEqual({ kind: 'visit', date: '2026-08-20', label: '진료일' })
  expect(report.trends?.every((trend) => trend.markers?.length)).toBe(true)
  const withoutAI = await mockApi.summary('2026-09-27', undefined, false)
  expect(withoutAI).toEqual(report)
})

it('과거 날짜를 선택해 저장하면 저장한 오늘이 아닌 선택한 하루만 통계에 들어간다', async () => {
  const input = await create('2026-01-10', '어제 새벽에 두 번 깨셨다.')
  await mockApi.confirmMemo(input.memo_id, {
    manual: true,
    events: [
      {
        type: '야간 각성',
        status: '있었음',
        time_expr: '어제 새벽',
        count: 2,
        evidence: '어제 새벽에 두 번 깨셨다.',
        model_event_index: null,
      },
    ],
  })
  const report = await mockApi.summary('2026-01-10')
  expect(report.period).toEqual({ start: '2026-01-10', end: '2026-01-10' })
  expect(report.coverage.recorded_days).toBe(1)
  expect(rowOf(report, '야간 각성').occurrence_dates).toEqual(['2026-01-10'])
  expect(await mockApi.memos({ from: '2026-01-09', to: '2026-01-09' })).toEqual([])
  expect((await mockApi.memos({ from: '2026-01-10', to: '2026-01-10' }))[0].memo_id).toBe(
    input.memo_id,
  )
})

it('사건 없는 확인 완료 메모도 선택한 기록 날짜 하루로 집계한다', async () => {
  await confirmed('2026-01-10', '야간 각성')
  const routine = await create('2026-01-11', '가족사진을 함께 봤다.')
  await mockApi.confirmMemo(routine.memo_id, { manual: true, events: [] })
  const pending = await create('2026-01-12')
  const failed = await create('2026-01-13', '직접 정리할 원문')
  const report = await mockApi.summary('2026-01-13', '2026-01-10')
  expect(report.coverage.recorded_days).toBe(2)
  expect(rowOf(report, '야간 각성')).toMatchObject({
    occurrence_days: 1,
    recorded_days: 2,
    current_rate: 0.5,
  })
  expect(report.exclusions).toEqual({
    pending_memo_ids: [pending.memo_id],
    failed_memo_ids: [failed.memo_id],
  })
  expect(report.sentences[0].evidence_dates).toEqual(['2026-01-10', '2026-01-11'])
})

it('같은 날짜의 여러 메모는 기록일과 발생일을 한 번만 세고 횟수는 합산한다', async () => {
  await mockApi.addVisit({ visit_date: '2026-01-01', status: '완료' })
  await mockApi.addVisit({ visit_date: '2026-02-01', status: '완료' })
  const baseline = await create('2026-01-01')
  await mockApi.confirmMemo(baseline.memo_id, { events: [] })
  const presentIds: number[] = []
  for (const count of [2, 3]) {
    const memo = await create('2026-02-01')
    presentIds.push(memo.memo_id)
    await mockApi.confirmMemo(memo.memo_id, { events: [{ ...memo.events[0], count }] })
  }
  await confirmed('2026-02-01', '야간 각성', '없었음')
  for (let day = 1; day <= 14; day++) {
    const memo = await create(`2026-02-${String(day).padStart(2, '0')}`)
    await mockApi.confirmMemo(memo.memo_id, { events: [] })
  }
  const report = await mockApi.summary('2026-02-14')
  const row = rowOf(report, '야간 각성')
  expect(report.coverage.recorded_days).toBe(14)
  expect(row).toMatchObject({
    occurrence_days: 1,
    absent_days: 0,
    recorded_days: 14,
    current_rate: 1 / 14,
    weekly_count: 2.5,
  })
  expect(row.current_evidence_dates).toEqual(['2026-02-01'])
  expect(row.current_memo_ids).toEqual(presentIds)
  const firstWeek = (await mockApi.trends('야간 각성', '2026-02-14')).weeks.find(
    (week) => week.period === 'current',
  )!
  expect(firstWeek).toMatchObject({ recorded_days: 1, event_days: 1 })
})

it('과거 없었음 카드를 제외해도 발생 통계와 원본을 보존하고 이후 삭제한 발생 사건은 다시 집계하지 않는다', async () => {
  const original = (await mockApi.memos()).find((memo) => memo.memo_id === 97)!
  const occurred = original.events.filter((event) => event.status === '있었음')
  expect(original.events.some((event) => event.status === '없었음')).toBe(true)
  expect(occurred).toHaveLength(1)
  expect(original.model_output).toBeTruthy()
  const before = await mockApi.summary('2026-09-27')
  const beforeTrend = await mockApi.trends('야간 각성', '2026-09-27')
  const statistics = (report: Summary) =>
    report.rows.map((row) => ({
      type: row.type,
      recorded_days: row.recorded_days,
      occurrence_days: row.occurrence_days,
      current_rate: row.current_rate,
      weekly_count: row.weekly_count,
    }))

  const saved = await mockApi.confirmMemo(original.memo_id, { events: occurred })
  const after = await mockApi.summary('2026-09-27')
  expect(saved).toMatchObject({
    text: original.text,
    record_date: original.record_date,
    model_output: original.model_output,
    events: occurred,
  })
  expect(after.coverage).toEqual(before.coverage)
  expect(statistics(after)).toEqual(statistics(before))
  expect(await mockApi.trends('야간 각성', '2026-09-27')).toEqual(beforeTrend)
  const [correction] = await mockApi.memoRevisions(original.memo_id)
  expect(correction).toMatchObject({
    kind: '정정',
    before_events: original.events,
    after_events: occurred,
  })

  await mockApi.confirmMemo(original.memo_id, { events: [] })
  const reread = (await mockApi.memos()).find((memo) => memo.memo_id === original.memo_id)!
  expect(reread).toMatchObject({
    status: '확인 완료',
    text: original.text,
    model_output: original.model_output,
    events: [],
  })
  const removed = await mockApi.summary('2026-09-27')
  const beforeRow = rowOf(before, '야간 각성')
  const removedRow = rowOf(removed, '야간 각성')
  expect(removed.coverage).toEqual(before.coverage)
  expect(removedRow.occurrence_days).toBe(beforeRow.occurrence_days - 1)
  expect(removedRow.current_rate).toBe((beforeRow.occurrence_days - 1) / beforeRow.recorded_days)
  expect(removedRow.weekly_count).toBeCloseTo(
    beforeRow.weekly_count! - (occurred[0].count / beforeRow.recorded_days) * 7,
  )
  expect(removedRow.current_memo_ids).not.toContain(original.memo_id)
  expect(removedRow.occurrence_dates).not.toContain(original.record_date)
  expect((await mockApi.memoRevisions(original.memo_id))[0]).toMatchObject({
    before_events: occurred,
    after_events: [],
  })
})

it('없었음만 있던 메모를 빈 사건으로 재확정해도 해당 기록일과 원문·AI 출력·정정 전 이력은 남는다', async () => {
  const original = (await mockApi.memos()).find((memo) => memo.memo_id === 2)!
  expect(original.events).toHaveLength(1)
  expect(original.events[0].status).toBe('없었음')
  const before = await mockApi.summary(original.record_date, original.record_date)
  expect(before.coverage.recorded_days).toBe(1)
  expect(rowOf(before, '야간 각성').absent_days).toBe(1)

  const saved = await mockApi.confirmMemo(original.memo_id, {
    events: original.events.filter((event) => event.status === '있었음'),
  })
  const after = await mockApi.summary(original.record_date, original.record_date)
  expect(after.coverage).toEqual(before.coverage)
  expect(rowOf(after, '야간 각성')).toMatchObject({
    recorded_days: 1,
    occurrence_days: 0,
    current_rate: 0,
    absent_days: 0,
    unmentioned_days: 1,
  })
  expect(saved).toMatchObject({
    status: '확인 완료',
    text: original.text,
    model_output: original.model_output,
    events: [],
  })
  expect((await mockApi.memoRevisions(original.memo_id))[0]).toMatchObject({
    before_events: original.events,
    after_events: [],
  })
})

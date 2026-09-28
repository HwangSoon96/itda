// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Api } from '../src/api/port'

let api: Api
const sample = '새벽 3시쯤 깨서 현관문 열려고 하심. 저녁은 반 공기.'
beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-28T12:00:00+09:00'))
  vi.resetModules()
  api = (await import('../src/api/mock/mockApi')).mockApi
  await api.loadDemo()
})
afterEach(() => vi.useRealTimers())

async function create(recordDate: string, requestId?: string) {
  const pending = api.createMemo({ text: sample, record_date: recordDate, request_id: requestId })
  await vi.advanceTimersByTimeAsync(500)
  return pending
}

it('메모 전체를 삭제하면 원문·사건·수정 이력과 요약·차트의 기여가 함께 사라진다', async () => {
  const memo = (await api.memos()).find((item) => item.memo_id === 95)!
  await api.confirmMemo(memo.memo_id, {
    events: memo.events.map((event) => ({ ...event, count: 2 })),
  })
  expect(await api.memoRevisions(memo.memo_id)).toHaveLength(1)
  const before = await api.summary('2026-09-27')
  const beforeGraph = await api.trends('낙상', '2026-09-27')

  await expect(api.deleteMemo(memo.memo_id)).resolves.toBeUndefined()

  expect((await api.memos()).some((item) => item.memo_id === memo.memo_id)).toBe(false)
  await expect(api.memoRevisions(memo.memo_id)).rejects.toThrow('메모를 찾지 못했어요')
  await expect(api.confirmMemo(memo.memo_id, { events: [] })).rejects.toThrow(
    '메모를 찾지 못했어요',
  )
  await expect(api.addEvent({ ...memo.events[0], memo_id: memo.memo_id })).rejects.toThrow(
    '메모를 찾지 못했어요',
  )
  const after = await api.summary('2026-09-27')
  const afterGraph = await api.trends('낙상', '2026-09-27')
  expect(after.coverage.recorded_days).toBe(before.coverage.recorded_days - 1)
  expect(after.falls).toEqual(['2026-09-22'])
  expect(after.rows.every((row) => !row.memo_ids.includes(memo.memo_id))).toBe(true)
  expect(after.sentences.every((sentence) => !sentence.memo_ids?.includes(memo.memo_id))).toBe(true)
  const containingWeek = (weeks: typeof beforeGraph.weeks) =>
    weeks.find((week) => week.start <= memo.record_date && week.end >= memo.record_date)!
  expect(containingWeek(afterGraph.weeks).event_days).toBe(
    containingWeek(beforeGraph.weeks).event_days - 1,
  )
  expect(containingWeek(afterGraph.weeks).recorded_days).toBe(
    containingWeek(beforeGraph.weeks).recorded_days - 1,
  )
})

it.each(['확인 대기', '정리 실패'] as const)(
  '%s 메모도 삭제할 수 있고 제외 목록에서도 사라진다',
  async (status) => {
    const memo = (await api.memos()).find((item) => item.status === status)!
    await api.deleteMemo(memo.memo_id)
    expect((await api.memos()).some((item) => item.memo_id === memo.memo_id)).toBe(false)
    const report = await api.summary('2026-09-27')
    expect(report.exclusions?.pending_memo_ids).not.toContain(memo.memo_id)
    expect(report.exclusions?.failed_memo_ids).not.toContain(memo.memo_id)
    await expect(api.retryMemo(memo.memo_id)).rejects.toThrow('메모를 찾지 못했어요')
  },
)

it('같은 날짜에 다른 메모가 남아 있으면 기록일은 유지하고 삭제된 사건만 제외한다', async () => {
  const first = await create('2026-01-10')
  const second = await create('2026-01-10')
  await api.confirmMemo(first.memo_id, { events: first.events })
  await api.confirmMemo(second.memo_id, { events: [] })
  await api.deleteMemo(first.memo_id)
  const report = await api.summary('2026-01-10')
  expect(report.coverage.recorded_days).toBe(1)
  expect(report.rows.every((row) => row.occurrence_days === 0)).toBe(true)
  expect(
    (await api.memos({ from: '2026-01-10', to: '2026-01-10' })).map((memo) => memo.memo_id),
  ).toEqual([second.memo_id])
  await api.deleteMemo(second.memo_id)
  expect((await api.summary('2026-01-10')).coverage.recorded_days).toBe(0)
})

it('삭제 전 저장 요청을 다시 보내도 메모를 되살리지 않고 새 요청으로만 작성할 수 있다', async () => {
  const first = await create('2026-01-10', 'memo-delete-case')
  await api.deleteMemo(first.memo_id)
  await expect(
    api.createMemo({ text: sample, record_date: '2026-01-10', request_id: 'memo-delete-case' }),
  ).rejects.toThrow('삭제한 메모의 저장 요청')
  const second = await create('2026-01-10', 'memo-delete-new')
  expect(second.memo_id).not.toBe(first.memo_id)
  expect((await api.memos()).some((memo) => memo.memo_id === first.memo_id)).toBe(false)
  await expect(api.deleteMemo(first.memo_id)).rejects.toThrow('메모를 찾지 못했어요')
})

it('샘플 공간에서 삭제한 기록은 다른 공간을 지우지 않으며 다시 열어도 삭제 상태를 유지한다', async () => {
  const selected = (await api.memos())[0]
  await api.deleteMemo(selected.memo_id)
  await api.exitDemo()
  expect((await api.memos()).some((memo) => memo.memo_id === selected.memo_id)).toBe(true)
  await api.loadDemo()
  expect((await api.memos()).some((memo) => memo.memo_id === selected.memo_id)).toBe(false)
})

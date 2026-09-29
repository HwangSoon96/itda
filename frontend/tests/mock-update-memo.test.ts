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
async function update(id: number, text = sample, requestId?: string) {
  const pending = api.updateMemo(id, { text, request_id: requestId })
  await vi.advanceTimersByTimeAsync(500)
  return pending
}

it('원문을 수정하면 같은 ID·기록 날짜로 재정리하고 이전 확정·낙상·근거·이력을 무효화한다', async () => {
  const original = (await api.memos()).find((memo) => memo.memo_id === 95)!
  await api.confirmMemo(original.memo_id, {
    events: original.events.map((event) => ({ ...event, count: 2 })),
  })
  expect(await api.memoRevisions(original.memo_id)).toHaveLength(1)
  const before = await api.summary('2026-09-27')
  const beforeGraph = await api.trends('낙상', '2026-09-27')
  const pending = api.updateMemo(original.memo_id, { text: sample, request_id: 'edit-fall' })
  const during = await api.summary('2026-09-27')
  expect(during.coverage.recorded_days).toBe(before.coverage.recorded_days - 1)
  expect(during.falls).not.toContain(original.record_date)
  expect(during.exclusions?.pending_memo_ids).toContain(original.memo_id)
  await vi.advanceTimersByTimeAsync(500)
  const edited = await pending
  expect(edited).toMatchObject({
    memo_id: original.memo_id,
    record_date: original.record_date,
    text: sample,
    status: '확인 대기',
    error: null,
  })
  expect(edited.events.map((event) => event.model_event_index)).toEqual([0, 1, 2])
  expect(edited.events.every((event) => sample.includes(event.evidence))).toBe(true)
  expect(edited.events.some((event) => event.type === '낙상')).toBe(false)
  expect(edited.model_output).not.toBe(original.model_output)
  expect(await api.memoRevisions(original.memo_id)).toEqual([])
  const afterGraph = await api.trends('낙상', '2026-09-27')
  const week = (weeks: typeof beforeGraph.weeks) =>
    weeks.find((item) => item.start <= original.record_date && item.end >= original.record_date)!
  expect(week(afterGraph.weeks).event_days).toBe(week(beforeGraph.weeks).event_days - 1)
  expect(during.rows.every((row) => !row.memo_ids.includes(original.memo_id))).toBe(true)

  await api.confirmMemo(edited.memo_id, { events: edited.events })
  const confirmed = await api.summary('2026-09-27')
  expect(confirmed.coverage.recorded_days).toBe(before.coverage.recorded_days)
  expect(confirmed.falls).not.toContain(original.record_date)
  expect((await api.memoRevisions(edited.memo_id))[0]).toMatchObject({
    kind: '최초 확인',
    before_events: edited.events,
    after_events: edited.events,
  })
})

it('재정리가 실패해도 새 원문은 저장되고 이전 모델 출처를 재사용할 수 없다', async () => {
  const original = (await api.memos()).find((memo) => memo.memo_id === 97)!
  const text = '숨이 차서 잠시 쉬셨다. 새로 수정한 관찰 메모.'
  const edited = await update(original.memo_id, text, 'edit-failed')
  expect(edited).toMatchObject({
    memo_id: original.memo_id,
    record_date: original.record_date,
    text,
    status: '정리 실패',
    events: [],
    model_output: null,
    failure_code: 'unknown_error',
    emergency: { matched: true },
  })
  expect(edited.error).toContain('화면 개발용 샘플')
  expect((await api.memos()).find((memo) => memo.memo_id === original.memo_id)).toEqual(edited)
  expect((await api.summary('2026-09-27')).exclusions?.failed_memo_ids).toContain(original.memo_id)
  await expect(api.confirmMemo(original.memo_id, { events: original.events })).rejects.toThrow(
    '직접 정리',
  )
  await expect(
    api.confirmMemo(original.memo_id, {
      manual: true,
      events: [{ ...original.events[0], evidence: text, time_expr: null }],
    }),
  ).rejects.toThrow('AI 사건 출처 번호')
  expect(await api.memoRevisions(original.memo_id)).toEqual([])
})

it('같은 수정 요청 재전송은 새 확정을 초기화하지 않고 다른 원문·메모·오래된 요청은 거부한다', async () => {
  const edited = await update(95, sample, 'one-edit')
  await api.confirmMemo(edited.memo_id, { events: edited.events.slice(1) })
  const revisions = await api.memoRevisions(95)
  const repeated = await api.updateMemo(95, { text: sample, request_id: 'one-edit' })
  expect(repeated.status).toBe('확인 완료')
  expect(repeated.events).toEqual(edited.events.slice(1))
  expect(await api.memoRevisions(95)).toEqual(revisions)
  await expect(api.updateMemo(95, { text: '다른 원문', request_id: 'one-edit' })).rejects.toThrow(
    '다른 메모나 원문',
  )
  await expect(api.updateMemo(97, { text: sample, request_id: 'one-edit' })).rejects.toThrow(
    '다른 메모나 원문',
  )
  for (const text of ['', ' '.repeat(3), '가'.repeat(10001)])
    await expect(api.updateMemo(95, { text })).rejects.toThrow('1~10,000자')
  expect((await api.memos()).find((memo) => memo.memo_id === 95)).toEqual(repeated)
  await update(95, '이후에 다시 수정한 원문', 'later-edit')
  await expect(api.updateMemo(95, { text: sample, request_id: 'one-edit' })).rejects.toThrow(
    '이미 다른 원문',
  )
  expect((await api.memos()).find((memo) => memo.memo_id === 95)?.text).toBe(
    '이후에 다시 수정한 원문',
  )
})

it('수정 중 삭제하거나 삭제 후 같은 요청을 재전송해도 삭제한 메모를 되살리지 않는다', async () => {
  const pending = api.updateMemo(95, { text: sample, request_id: 'delete-in-edit' })
  const rejected = expect(pending).rejects.toThrow('메모를 찾지 못했어요')
  await api.deleteMemo(95)
  await vi.advanceTimersByTimeAsync(500)
  await rejected
  await expect(api.updateMemo(95, { text: sample, request_id: 'delete-in-edit' })).rejects.toThrow(
    '삭제한 메모',
  )
  await expect(
    api.createMemo({ text: sample, record_date: '2026-09-09', request_id: 'delete-in-edit' }),
  ).rejects.toThrow('삭제한 메모')
  expect((await api.memos()).some((memo) => memo.memo_id === 95)).toBe(false)
  await expect(api.memoRevisions(95)).rejects.toThrow('메모를 찾지 못했어요')
})

it('수정 내용과 중복 요청은 기록 공간별로 보관한다', async () => {
  const original = (await api.memos()).find((memo) => memo.memo_id === 95)!
  const edited = await update(95, sample, 'workspace-edit')
  await api.exitDemo()
  expect((await api.memos()).find((memo) => memo.memo_id === 95)).toEqual(original)
  await api.loadDemo()
  expect(await api.updateMemo(95, { text: sample, request_id: 'workspace-edit' })).toEqual(edited)
})

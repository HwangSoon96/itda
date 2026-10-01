// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Api } from '../src/api'
let api: Api
let adopt: (id: string) => void
beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-27T12:00:00+09:00'))
  vi.stubEnv('VITE_USE_MOCK', 'true')
  vi.resetModules()
  const module = await import('../src/api')
  api = module.api
  adopt = module.adoptWorkspace
  adopt((await api.health()).workspace_id)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

it('범위가 같은 질문도 다른 날 다시 적으면 새 작성일로 저장한다', async () => {
  const question = {
    text: '밤에 깨는 일을 어떻게 기록할까요?',
    period_start: '2026-08-20',
    period_end: '2026-09-27',
  }
  const first = await api.addQuestion(question)
  expect((await api.addQuestion(question)).id).toBe(first.id)
  vi.setSystemTime(new Date('2026-09-28T12:00:00+09:00'))
  const second = await api.addQuestion(question)
  expect(second.id).not.toBe(first.id)
  expect(first.created_at).toBe('2026-09-27')
  expect(second.created_at).toBe('2026-09-28')
  expect((await api.addQuestion(question)).id).toBe(second.id)
})

it('샘플도 공간 전환 뒤 토큰을 명시적으로 채택하기 전에는 쓰기를 허용하지 않는다', async () => {
  const before = await api.health()
  const switched = await api.loadDemo()
  expect(switched.workspace_id).not.toBe(before.workspace_id)
  expect((await api.health()).workspace_id).toBe(switched.workspace_id)
  await expect(api.addQuestion({ text: '이전 공간에서 보낸 질문' })).rejects.toMatchObject({
    code: 'workspace_changed',
  })
  adopt(switched.workspace_id)
  expect((await api.questions()).some((item) => item.text === '이전 공간에서 보낸 질문')).toBe(
    false,
  )
  const restored = await api.exitDemo()
  expect(restored.workspace_id).not.toBe(switched.workspace_id)
  await expect(api.memos()).rejects.toMatchObject({ code: 'workspace_changed' })
  adopt(restored.workspace_id)
  await expect(api.memos()).resolves.toBeInstanceOf(Array)
})

it('샘플 카드도 편집·순서 변경 뒤 AI 순번을 보존하며 수동 카드의 출처는 null이다', async () => {
  const request = api.createMemo({
    text: '새벽 3시쯤 깨서 현관문 열려고 하심. 저녁은 반 공기.',
    record_date: '2026-09-27',
  })
  await vi.advanceTimersByTimeAsync(500)
  const pending = await request
  const original = pending.model_output
  expect(JSON.parse(original!)[0]).toEqual({
    type: '야간 각성',
    status: '있었음',
    time_expr: '새벽',
    count: 1,
    evidence: '3시쯤 깨서',
  })
  expect(pending.events.map((event) => event.model_event_index)).toEqual([0, 1, 2])
  const edited = {
    ...pending.events[1],
    type: '불안' as const,
    status: '없었음' as const,
    time_expr: '저녁',
    evidence: '저녁은 반 공기',
    count: 3,
  }
  const manual = { ...pending.events[0], type: '낙상' as const, model_event_index: null }
  const confirmed = await api.confirmMemo(pending.memo_id, {
    events: [pending.events[2], edited, manual],
  })
  expect(confirmed.events.map((event) => event.model_event_index)).toEqual([2, 1, null])
  expect(confirmed.events[1]).toEqual(edited)
  expect(confirmed.model_output).toBe(original)
  await expect(api.addEvent({ memo_id: pending.memo_id, ...pending.events[0] })).rejects.toThrow(
    '출처 번호',
  )
  const added = await api.addEvent({ memo_id: pending.memo_id, ...manual, type: '망상' })
  expect(added.events.at(-1)?.model_event_index).toBeNull()
  expect(added.model_output).toBe(original)
  await expect(api.confirmMemo(pending.memo_id, { events: [edited, edited] })).rejects.toThrow(
    '출처 번호',
  )
  await expect(
    api.confirmMemo(pending.memo_id, { events: [{ ...edited, model_event_index: 3 }] }),
  ).rejects.toThrow('출처 번호')
})

it('데모를 반복 불러오거나 나갔다 돌아와도 추가한 메모와 질문을 보존한다', async () => {
  const originalQuestion = await api.addQuestion({ text: '내 기록에만 남길 질문' })
  adopt((await api.loadDemo()).workspace_id)
  const demoQuestion = await api.addQuestion({ text: '데모에서 추가한 질문' })
  const pending = api.createMemo({
    text: '새벽 3시쯤 깨서 현관문 열려고 하심. 저녁은 반 공기.',
    record_date: '2026-09-27',
    request_id: 'preserve-demo',
  })
  await vi.advanceTimersByTimeAsync(500)
  const memo = await pending
  const confirmed = await api.confirmMemo(memo.memo_id, { events: memo.events })
  const memoCount = (await api.memos()).length
  const firstWorkspace = (await api.health()).workspace_id
  const repeated = await api.loadDemo()
  expect(repeated.workspace_id).not.toBe(firstWorkspace)
  adopt(repeated.workspace_id)
  expect((await api.memos()).length).toBe(memoCount)
  expect((await api.memos()).find((item) => item.memo_id === memo.memo_id)).toEqual(confirmed)
  expect(await api.questions()).toContainEqual(demoQuestion)
  adopt((await api.exitDemo()).workspace_id)
  expect(await api.questions()).toContainEqual(originalQuestion)
  expect((await api.questions()).some((item) => item.text === demoQuestion.text)).toBe(false)
  adopt((await api.loadDemo()).workspace_id)
  expect((await api.memos()).length).toBe(memoCount)
  expect((await api.memos()).find((item) => item.memo_id === memo.memo_id)).toEqual(confirmed)
  expect(await api.questions()).toContainEqual(demoQuestion)
  expect((await api.questions()).some((item) => item.text === originalQuestion.text)).toBe(false)
  expect(
    await api.createMemo({
      text: memo.text,
      record_date: memo.record_date,
      request_id: 'preserve-demo',
    }),
  ).toEqual(confirmed)
})

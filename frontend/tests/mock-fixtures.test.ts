// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Api } from '../src/api'
import type { EventCard } from '../src/api/types'
import demoMemos from '../src/api/mock/fixtures/demo_memos.json'
import demoEvents from '../src/api/mock/fixtures/demo_events.json'
import context from '../src/api/mock/fixtures/demo_context.json'
let api: Api
beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-27T12:00:00+09:00'))
  vi.resetModules()
  api = (await import('../src/api/mock/mockApi')).mockApi
  await api.loadDemo()
})
afterEach(() => vi.useRealTimers())
const originalFields = ({ type, status, time_expr, count, evidence }: EventCard) => ({
  type,
  status,
  time_expr,
  count,
  evidence,
})

it('공통 데모의 원문·승인 상태·확정 사건·일정을 그대로 사용한다', async () => {
  expect((await api.health()).demo_as_of).toBe(context.as_of)
  expect(await api.patient()).toEqual({ alias: context.patient_alias })
  expect((await api.visits()).map(({ id: _id, ...item }) => item)).toEqual(context.visits)
  expect((await api.medications()).map(({ id: _id, ...item }) => item)).toEqual(context.medications)
  const questions = (await api.questions()).map(({ id: _id, ...item }) => item)
  expect(questions).toHaveLength(context.questions.length)
  expect(questions).toEqual(expect.arrayContaining(context.questions))
  const loaded = await api.memos()
  expect(loaded).toHaveLength(demoMemos.length)
  for (const raw of demoMemos) {
    const memo = loaded.find((item) => item.memo_id === raw.id)!
    expect(memo).toMatchObject({
      text: raw.text,
      record_date: raw.record_date,
      status: raw.status,
    })
    if (raw.status !== '확인 완료') continue
    const approved = demoEvents
      .filter((event) => event.memo_id === raw.id)
      .map(({ memo_id: _id, ...event }) => event)
    expect(memo.events).toEqual(
      approved.map((event, index) => ({ ...event, model_event_index: index })),
    )
    expect(JSON.parse(memo.model_output!)).toEqual(
      approved.map((event) => originalFields(event as EventCard)),
    )
  }
})

it('확인 전 사건은 날짜를 생성하지 않고 메모의 기록 날짜와 AI 5필드를 보존한다', async () => {
  const loaded = await api.memos()
  const pending = demoMemos.filter((memo) => memo.status === '확인 대기')
  const seenExpressions = new Set<string | null>()
  for (const raw of pending) {
    const memo = loaded.find((item) => item.memo_id === raw.id)!
    expect(JSON.parse(memo.model_output!)).toEqual(raw.model_events)
    expect(memo.events).toHaveLength(raw.model_events!.length)
    for (const [index, event] of memo.events.entries()) {
      seenExpressions.add(event.time_expr)
      expect(event.model_event_index).toBe(index)
      expect(memo.record_date).toBe(raw.record_date)
      expect(event).not.toHaveProperty('event_date')
      expect(event).not.toHaveProperty('date_unknown')
      expect(raw.text).toContain(event.evidence)
      expect(Object.keys(JSON.parse(memo.model_output!)[index]).sort()).toEqual([
        'count',
        'evidence',
        'status',
        'time_expr',
        'type',
      ])
    }
  }
  expect(seenExpressions).toEqual(new Set(['오늘', '오후', null]))
  const failed = demoMemos.filter((memo) => memo.status === '정리 실패')
  expect(failed.length).toBeGreaterThan(0)
  for (const raw of failed) {
    const memo = loaded.find((item) => item.memo_id === raw.id)!
    expect(memo.events).toEqual([])
    expect(memo.model_output).toBeNull()
    expect(memo.error).toBe(raw.error)
  }
})

it('준비된 신규 입력 예시 이외의 글을 AI가 정리한 것처럼 반환하지 않는다', async () => {
  const request = api.createMemo({
    text: '임의 입력은 실제 모델 없이 사건을 만들어 주면 안 됩니다.',
    record_date: context.as_of,
  })
  await vi.advanceTimersByTimeAsync(500)
  const memo = await request
  expect(memo.status).toBe('정리 실패')
  expect(memo.events).toEqual([])
  expect(memo.model_output).toBeNull()
  expect(memo.error).toContain('화면 개발용 샘플 모드')
})

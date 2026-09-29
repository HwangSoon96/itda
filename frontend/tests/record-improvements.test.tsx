import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecordPage } from '../src/features/records/RecordPage'
import { localToday } from '../src/shared/lib/date'
import type { EventCard, Health, MemoResult } from '../src/api/types'
const api = vi.hoisted(() => ({
  questions: vi.fn(),
  memos: vi.fn(),
  confirmMemo: vi.fn(),
  createMemo: vi.fn(),
  retryMemo: vi.fn(),
  addEvent: vi.fn(),
  addQuestion: vi.fn(),
  memoRevisions: vi.fn(),
}))
vi.mock('../src/api', () => ({ api }))
const health: Health = {
  workspace_id: 'test',
  ok: true,
  ai_available: true,
  model_name: 'test',
  allow_lan: false,
  emergency_keywords: [],
  emergency_message: '',
  ai_notice: 'AI가 정리한 내용이에요.',
  disclaimer: '',
}
const event: EventCard = {
  type: '야간 각성',
  status: '있었음',
  count: 1,
  evidence: '밤에 깼어요.',
  time_expr: '밤',
  model_event_index: 0,
}
const memo = (overrides: Partial<MemoResult> = {}): MemoResult => ({
  memo_id: 41,
  status: '확인 완료',
  text: '밤에 깼어요. 저녁 식사는 잘 드셨어요.',
  record_date: '2026-09-26',
  events: [event],
  model_output: JSON.stringify([
    {
      type: event.type,
      status: event.status,
      count: 1,
      evidence: event.evidence,
      time_expr: '밤',
    },
  ]),
  emergency: { matched: false, message: null },
  ...overrides,
})
let records: MemoResult[]
beforeEach(() => {
  vi.resetAllMocks()
  api.questions.mockResolvedValue([])
  window.history.replaceState(null, '', '#record')
  records = [memo()]
  api.memos.mockImplementation(async () => records)
  api.memoRevisions.mockResolvedValue([])
  api.confirmMemo.mockImplementation(async (id: number, body: { events: EventCard[] }) => {
    const result = {
      ...records.find((item) => item.memo_id === id)!,
      status: '확인 완료' as const,
      error: null,
      events: body.events,
    }
    records = records.map((item) => (item.memo_id === id ? result : item))
    return result
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  window.history.replaceState(null, '', '#record')
})
async function openRecord(user: ReturnType<typeof userEvent.setup>) {
  render(<RecordPage health={health} />)
  await user.click(screen.getByRole('button', { name: '지난 기록 찾기' }))
  const history = within(screen.getByRole('complementary', { name: '최근 기록' }))
  await user.click(await history.findByRole('button', { name: /2026년 9월 26일/ }))
}
async function openEditors(user: ReturnType<typeof userEvent.setup>) {
  const toggle = screen.queryAllByRole('button', { name: /^\d+번 .+ 수정$/ })[0]
  if (toggle) await user.click(toggle)
}
async function editCount(user: ReturnType<typeof userEvent.setup>, value: string) {
  if (!screen.queryByRole('dialog', { name: '내용 수정' })) await openEditors(user)
  fireEvent.change(screen.getByLabelText(/^횟수/), { target: { value } })
  await user.click(screen.getByRole('button', { name: '수정 적용' }))
}
function selectManualEvidence(excerpt: string) {
  const manual = within(screen.getByRole('dialog', { name: '빠진 사건 추가' }))
  const source = manual.getByRole('textbox', { name: '원문에서 근거 선택' }) as HTMLTextAreaElement
  const start = source.value.indexOf(excerpt)
  expect(start).toBeGreaterThanOrEqual(0)
  source.focus()
  source.setSelectionRange(start, start + excerpt.length)
  fireEvent.select(source)
  return source
}
async function closeFeedback(user: ReturnType<typeof userEvent.setup>) {
  const feedback =
    screen.queryByRole('dialog', { name: '완료했어요' }) ??
    screen.queryByRole('alertdialog', { name: '다시 확인해 주세요' })
  if (feedback) await user.click(within(feedback).getByRole('button', { name: '확인' }))
}
async function savedBack(
  user: ReturnType<typeof userEvent.setup>,
  destination: 'history' | 'write' = 'history',
) {
  await screen.findByRole('heading', {
    name: destination === 'history' ? '지난 기록 찾기' : '오늘 하루는 어떠셨나요?',
  })
  expect(screen.queryByRole('dialog', { name: '정리된 내용', exact: true })).toBeNull()
  expect((screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement).value).toBe('')
  expect((screen.getByLabelText('기록 날짜') as HTMLInputElement).value).toBe(localToday())
  await closeFeedback(user)
}
async function returnToHistory(
  user: ReturnType<typeof userEvent.setup>,
  origin: 'compose' | 'history',
) {
  await closeFeedback(user)
  const detail = screen.queryByRole('dialog', { name: '정리된 내용', exact: true })
  if (detail) await user.click(within(detail).getByRole('button', { name: '닫기', exact: true }))
  if (origin === 'compose') await user.click(screen.getByRole('button', { name: '지난 기록 찾기' }))
  await screen.findByRole('heading', { name: '지난 기록 찾기' })
  if (origin === 'history') {
    expect((screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement).value).toBe('')
    expect((screen.getByLabelText('기록 날짜') as HTMLInputElement).value).toBe(localToday())
  }
}

const absentEvent: EventCard = {
  type: '불안',
  status: '없었음',
  count: 1,
  time_expr: '낮',
  evidence: '낮에는 불안하지 않으셨어요.',
  model_event_index: 0,
}

it.each(['확인 대기', '확인 완료'] as const)(
  '%s 메모의 없었음 카드는 표시하지 않고 수정 없이 닫으면 원본을 그대로 둔다',
  async (status) => {
    const user = userEvent.setup()
    records = [
      memo({
        status,
        text: `${memo().text} ${absentEvent.evidence}`,
        events: [absentEvent, { ...event, model_event_index: 1 }],
      }),
    ]
    await openRecord(user)
    const detail = within(screen.getByRole('dialog', { name: '정리된 내용', exact: true }))
    expect(detail.queryByRole('group', { name: '관찰 상태' })).toBeNull()
    expect(detail.queryByRole('button', { name: '있었음', exact: true })).toBeNull()
    expect(detail.queryByRole('button', { name: '없었음', exact: true })).toBeNull()
    expect(detail.queryByRole('heading', { name: '불안', exact: true })).toBeNull()
    expect(detail.getByRole('heading', { name: '야간 각성', exact: true })).toBeTruthy()
    await user.click(detail.getByRole('button', { name: '닫기', exact: true }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.queryByRole('dialog', { name: '정리된 내용', exact: true })).toBeNull()
    expect(screen.getByRole('heading', { name: '지난 기록 찾기', level: 1 })).toBeTruthy()
    expect(api.confirmMemo).not.toHaveBeenCalled()
    expect(records[0].events).toHaveLength(2)
    expect(records[0].events[0]).toEqual(absentEvent)
  },
)

it('긍정·부정이 섞인 결과에서 발생한 사건만 확인하고 원래 AI 출처 번호를 유지한다', async () => {
  const user = userEvent.setup()
  const present = { ...event, model_event_index: 2 }
  records = [
    memo({
      status: '확인 대기',
      text: `${memo().text} ${absentEvent.evidence}`,
      events: [absentEvent, present],
    }),
  ]
  await openRecord(user)
  expect(screen.getByRole('heading', { name: '정리된 내용 1건' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: '확인 완료' }))
  await savedBack(user)
  expect(api.confirmMemo).toHaveBeenCalledExactlyOnceWith(41, { events: [present] })
  expect(records[0].text).toContain(absentEvent.evidence)
})

it('없었음만 추출된 메모는 사건 0건으로 확인하며 발생 사건으로 바꾸지 않는다', async () => {
  const user = userEvent.setup()
  records = [memo({ status: '확인 대기', text: absentEvent.evidence, events: [absentEvent] })]
  await openRecord(user)
  expect(screen.getByRole('heading', { name: '정리된 사건이 없어요' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: '확인 완료' }))
  await savedBack(user)
  expect(api.confirmMemo).toHaveBeenCalledExactlyOnceWith(41, { events: [] })
  expect(records[0].text).toBe(absentEvent.evidence)
  expect(records[0].status).toBe('확인 완료')
})

it('확정 후 목록 재조회가 실패해도 최신 확정 내용을 다시 열어 이전 대기 카드로 덮어쓰지 않는다', async () => {
  records = [
    memo({
      status: '확인 대기',
      events: [event, { ...event, type: '불안', model_event_index: 1 }],
    }),
  ]
  const user = userEvent.setup()
  await openRecord(user)
  await user.click(screen.getByRole('button', { name: '2번 불안 카드 삭제' }))
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: '카드 삭제' }),
  )
  await editCount(user, '4')
  api.memos.mockRejectedValue(new Error('목록 재조회 실패'))
  await user.click(screen.getByRole('button', { name: '확인 완료' }))
  await savedBack(user)
  const history = screen.getByRole('complementary', { name: '최근 기록' })
  expect((await within(history).findByRole('alert')).textContent).toContain('목록 재조회 실패')
  const item = within(history).getByRole('button', { name: /2026년 9월 26일/ })
  expect(item.textContent).toContain('확인 완료')
  expect(item.textContent).not.toContain('확인 대기')
  await user.click(item)
  expect(screen.getByRole('region', { name: '확인 완료한 사건' }).textContent).toContain('4회')
  expect(
    within(screen.getByRole('region', { name: '확인 완료한 사건' })).queryByText('불안'),
  ).toBeNull()
  expect(screen.queryByRole('button', { name: '확인 완료' })).toBeNull()
  expect(api.confirmMemo).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: '확정 내용 수정' }))
  await user.click(screen.getByRole('button', { name: '변경 내용 검토' }))
  await user.click(screen.getByRole('button', { name: '다시 확정' }))
  expect(api.confirmMemo.mock.calls[1]).toEqual([41, { events: [{ ...event, count: 4 }] }])
})

it.each(['create', 'retry', 'add'] as const)(
  '%s 응답도 목록에 반영되어 후속 조회 실패로 새 기록이나 사건을 잃지 않는다',
  async (kind) => {
    const user = userEvent.setup()
    let saved: MemoResult
    if (kind === 'create') {
      records = []
      saved = memo({ status: '확인 대기', events: [{ ...event, count: 4 }] })
      api.createMemo.mockResolvedValue(saved)
      render(<RecordPage health={health} />)
      await waitFor(() => expect(api.memos).toHaveBeenCalledTimes(1))
      api.memos.mockRejectedValue(new Error('후속 목록 조회 실패'))
      await user.type(screen.getByLabelText('어떤 일이 있었나요?'), saved.text)
      fireEvent.change(screen.getByLabelText('기록 날짜'), {
        target: { value: saved.record_date },
      })
      await user.click(screen.getByRole('button', { name: '저장하고 정리하기' }))
      await screen.findByRole('heading', { name: /^정리된 내용 \d+건$/ })
    } else if (kind === 'retry') {
      records = [
        memo({ status: '정리 실패', events: [], error: '이전 실패', failure_code: 'timeout' }),
      ]
      await openRecord(user)
      saved = memo({ status: '확인 대기', events: [{ ...event, count: 4 }] })
      api.retryMemo.mockResolvedValue(saved)
      api.memos.mockRejectedValue(new Error('후속 목록 조회 실패'))
      await user.click(screen.getByRole('button', { name: '다시 시도' }))
      await screen.findByRole('heading', { name: /^정리된 내용 \d+건$/ })
    } else {
      await openRecord(user)
      const added = {
        ...event,
        count: 4,
        time_expr: null,
        evidence: event.evidence,
        model_event_index: null,
      }
      saved = memo({ events: [event, added] })
      api.addEvent.mockResolvedValue(saved)
      api.memos.mockRejectedValue(new Error('후속 목록 조회 실패'))
      await user.click(screen.getByRole('button', { name: '빠진 사건 추가' }))
      expect(screen.queryByLabelText(/^근거 구절/)).toBeNull()
      selectManualEvidence(added.evidence)
      fireEvent.change(screen.getByLabelText(/^횟수/), { target: { value: '4' } })
      await user.click(screen.getByRole('button', { name: '사건 추가' }))
      await waitFor(() => expect(screen.queryByRole('button', { name: '사건 추가' })).toBeNull())
    }
    await returnToHistory(user, kind === 'create' ? 'compose' : 'history')
    const history = screen.getByRole('complementary', { name: '최근 기록' })
    expect((await within(history).findByRole('alert')).textContent).toContain('후속 목록 조회 실패')
    const item = within(history).getByRole('button', { name: /2026년 9월 26일/ })
    expect(item.textContent).toContain(saved.status)
    await closeFeedback(user)
    await user.click(item)
    if (screen.queryByRole('alertdialog'))
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: '기록 열기' }),
      )
    expect(
      await screen.findByRole('heading', {
        name: kind === 'add' ? '확인 완료한 내용' : /^정리된 내용 \d+건$/,
      }),
    ).toBeTruthy()
    expect(screen.getAllByLabelText('근거 원문')).toHaveLength(saved.events.length)
    expect(screen.getByText(/4회/)).toBeTruthy()
  },
)

it('저장 전에 시작한 목록 응답이 늦게 도착해도 최신 확정 응답을 덮지 않는다', async () => {
  records = [memo({ status: '확인 대기' })]
  const stale = structuredClone(records)
  const user = userEvent.setup()
  await openRecord(user)
  let finish!: (value: MemoResult[]) => void
  api.memos.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  act(() => {
    window.dispatchEvent(new Event('itda-final-updated'))
  })
  api.memos.mockRejectedValue(new Error('최신 목록 조회 실패'))
  await editCount(user, '4')
  await user.click(screen.getByRole('button', { name: '확인 완료' }))
  await savedBack(user)
  await act(async () => finish(stale))
  const item = within(screen.getByRole('complementary', { name: '최근 기록' })).getByRole(
    'button',
    { name: /2026년 9월 26일/ },
  )
  expect(item.textContent).toContain('확인 완료')
  await user.click(item)
  expect(screen.getByRole('region', { name: '확인 완료한 사건' }).textContent).toContain('4회')
})

it('확정 사건을 수정·검토·재확정하며 서버 메타데이터를 제외하고 원본 출처를 보존한다', async () => {
  const user = userEvent.setup()
  records = [
    memo({
      events: [{ ...event, id: 501, memo_id: 41, source: '모델', edited: false } as EventCard],
    }),
  ]
  const updated = vi.fn()
  window.addEventListener('itda-final-updated', updated)
  try {
    await openRecord(user)
    await user.click(screen.getByRole('button', { name: '확정 내용 수정' }))
    await openEditors(user)
    await editCount(user, '4')
    await user.click(screen.getByRole('button', { name: '변경 내용 검토' }))
    expect(api.confirmMemo).not.toHaveBeenCalled()
    const review = screen.getByRole('dialog', { name: '변경 내용 검토' })
    expect(
      within(review).getByRole('heading', { name: '수정 전' }).parentElement?.textContent,
    ).toContain('1회')
    expect(
      within(review).getByRole('heading', { name: '수정 후' }).parentElement?.textContent,
    ).toContain('4회')
    await user.click(screen.getByRole('button', { name: '다시 확정' }))
    await savedBack(user)
    expect(api.confirmMemo).toHaveBeenCalledExactlyOnceWith(41, {
      events: [{ ...event, count: 4 }],
    })
    expect(updated).toHaveBeenCalledOnce()
  } finally {
    window.removeEventListener('itda-final-updated', updated)
  }
})

it('확정 수정 취소는 원래 내용을 복원하고 저장 요청을 보내지 않는다', async () => {
  const user = userEvent.setup()
  await openRecord(user)
  await user.click(screen.getByRole('button', { name: '확정 내용 수정' }))
  await openEditors(user)
  await editCount(user, '9')
  await user.click(screen.getByRole('button', { name: '변경 내용 검토' }))
  await user.click(screen.getByRole('button', { name: '계속 수정' }))
  expect(screen.getByText('9회')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: '수정 취소' }))
  expect(screen.getByRole('region', { name: '확인 완료한 사건' }).textContent).toContain('1회')
  expect(api.confirmMemo).not.toHaveBeenCalled()
})

it('재확정 실패 시 비교 내용을 보존하고 재시도할 수 있다', async () => {
  const user = userEvent.setup()
  await openRecord(user)
  api.confirmMemo.mockRejectedValueOnce(new Error('저장 응답 유실'))
  await user.click(screen.getByRole('button', { name: '확정 내용 수정' }))
  await editCount(user, '3')
  await user.click(screen.getByRole('button', { name: '변경 내용 검토' }))
  await user.click(screen.getByRole('button', { name: '다시 확정' }))
  expect((await screen.findByRole('alertdialog')).textContent).toContain('저장 응답 유실')
  await closeFeedback(user)
  expect(screen.getByRole('heading', { name: '수정 후' }).parentElement?.textContent).toContain(
    '3회',
  )
  await user.click(screen.getByRole('button', { name: '다시 확정' }))
  await savedBack(user)
  expect(api.confirmMemo.mock.calls[1]).toEqual(api.confirmMemo.mock.calls[0])
})

it('직접 정리는 선택한 원문 구절을 근거로 횟수·시간을 검증하고 수동 출처로 확인한다', async () => {
  records = [memo({ status: '정리 실패', events: [], error: '모델 연결 실패', model_output: null })]
  const user = userEvent.setup()
  await openRecord(user)
  await user.click(screen.getByRole('button', { name: '직접 정리' }))
  await user.click(screen.getByRole('button', { name: '빠진 사건 추가' }))
  expect(screen.queryByLabelText('관찰 상태')).toBeNull()
  expect(screen.queryByLabelText(/^근거 구절/)).toBeNull()
  const manual = within(screen.getByRole('dialog', { name: '빠진 사건 추가' }))
  const source = selectManualEvidence(event.evidence)
  expect(source.value).toBe(records[0].text)
  expect(source.readOnly).toBe(true)
  expect(manual.getByRole('region', { name: '선택한 근거' }).textContent).toContain(event.evidence)
  fireEvent.change(manual.getByLabelText(/^횟수/), { target: { value: '0' } })
  fireEvent.submit(screen.getByRole('button', { name: '사건 추가' }).closest('form')!)
  expect((await screen.findByRole('alert')).textContent).toContain('횟수는 1 이상의 정수')
  fireEvent.change(manual.getByLabelText(/^횟수/), { target: { value: '1' } })
  fireEvent.change(manual.getByLabelText(/^원문 시간 표현/), { target: { value: '아침' } })
  fireEvent.submit(screen.getByRole('button', { name: '사건 추가' }).closest('form')!)
  expect(manual.getByRole('alert').textContent).toContain('시간 표현은 원문에 있는 말')
  expect(api.addEvent).not.toHaveBeenCalled()
  expect(api.confirmMemo).not.toHaveBeenCalled()
  fireEvent.change(manual.getByLabelText(/^원문 시간 표현/), { target: { value: '' } })
  await user.click(screen.getByRole('button', { name: '사건 추가' }))
  expect(api.addEvent).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '확인 완료' }))
  await savedBack(user)
  expect(api.confirmMemo).toHaveBeenCalledExactlyOnceWith(41, {
    manual: true,
    events: [{ ...event, time_expr: null, model_event_index: null }],
  })
  expect(api.retryMemo).not.toHaveBeenCalled()
  expect(records[0].text).toBe(memo().text)
})

it('실패 메모도 사건을 만들지 않고 원문만 직접 확인하거나 취소할 수 있다', async () => {
  records = [memo({ status: '정리 실패', events: [], error: '정리 실패', model_output: null })]
  const user = userEvent.setup()
  await openRecord(user)
  await user.click(screen.getByRole('button', { name: '직접 정리' }))
  await user.click(screen.getByRole('button', { name: '수정 취소' }))
  await closeFeedback(user)
  expect(screen.getByRole('button', { name: '다시 시도' })).toBeTruthy()
  expect(api.confirmMemo).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '직접 정리' }))
  await user.click(screen.getByRole('button', { name: '확인 완료' }))
  expect(api.confirmMemo).toHaveBeenCalledExactlyOnceWith(41, { events: [], manual: true })
})

it('사건 수정은 원문의 시간 표현만 선택적으로 바꾸며 메모 날짜를 유지한다', async () => {
  records = [memo({ status: '확인 대기' })]
  const user = userEvent.setup()
  await openRecord(user)
  await openEditors(user)
  const dialog = screen.getByRole('dialog', { name: '내용 수정' })
  const editor = within(dialog)
  expect(dialog.querySelector('input[type="date"]')).toBeNull()
  expect(editor.queryByRole('checkbox')).toBeNull()
  const time = editor.getByLabelText(/^원문 시간 표현/)
  await user.clear(time)
  await user.type(time, '저녁')
  await user.click(editor.getByRole('button', { name: '수정 적용' }))
  expect(screen.getByText('저녁')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: '확인 완료' }))
  expect(api.confirmMemo).toHaveBeenCalledWith(41, { events: [{ ...event, time_expr: '저녁' }] })
  expect(records[0].record_date).toBe('2026-09-26')
})

it.each(['확인 대기', '확인 완료'] as const)(
  '%s 메모를 열고 다시 열어도 변경 이력을 표시하거나 조회하지 않는다',
  async (status) => {
    records = [memo({ status })]
    const user = userEvent.setup()
    await openRecord(user)
    const detail = within(screen.getByRole('dialog', { name: '정리된 내용', exact: true }))
    expect(detail.queryByText('변경 이력')).toBeNull()
    expect(api.memoRevisions).not.toHaveBeenCalled()
    await user.click(detail.getByRole('button', { name: '닫기', exact: true }))
    await user.click(
      within(screen.getByRole('complementary', { name: '최근 기록' })).getByRole('button', {
        name: /2026년 9월 26일/,
      }),
    )
    expect(screen.getByRole('dialog', { name: '정리된 내용', exact: true })).toBeTruthy()
    expect(screen.queryByText('변경 이력')).toBeNull()
    expect(api.memoRevisions).not.toHaveBeenCalled()
    expect(api.confirmMemo).not.toHaveBeenCalled()
  },
)

it('직접 링크는 해당 메모를 열며 작성 중인 내용을 취소 동의 없이 덮어쓰지 않는다', async () => {
  records = [memo(), memo({ memo_id: 42, text: '다른 메모 원문', events: [] })]
  window.history.replaceState(null, '', '#record?memo=42')
  render(<RecordPage health={health} />)
  await waitFor(() =>
    expect(
      screen.getByRole('heading', { name: '작성한 메모' }).closest('section')?.textContent,
    ).toContain('다른 메모 원문'),
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '확정 내용 수정' }))
  act(() => {
    window.history.replaceState(null, '', '#record?memo=41')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', { name: '취소' }),
  )
  expect(screen.getByRole('heading', { name: '확정 내용 수정' })).toBeTruthy()
  expect(location.hash).toBe('#record?memo=42')
  act(() => {
    window.history.replaceState(null, '', '#record?memo=41')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', { name: '기록 열기' }),
  )
  await waitFor(() =>
    expect(
      screen.getByRole('heading', { name: '작성한 메모' }).closest('section')?.textContent,
    ).toContain(memo().text),
  )
  expect(location.hash).toBe('#record?memo=41')
})

it('연결된 기록의 수정·확정·새 메모 전환에도 요약지 조회 기간을 보존하고 주소 변경을 알린다', async () => {
  window.history.replaceState(null, '', '#record?as_of=2026-09-27&period_start=2026-08-21&memo=41')
  const user = userEvent.setup()
  const changed = vi.fn()
  window.addEventListener('hashchange', changed)
  try {
    render(<RecordPage health={health} />)
    await user.click(await screen.findByRole('button', { name: '확정 내용 수정' }))
    await openEditors(user)
    await editCount(user, '3')
    // Changing report context for the same memo must not reopen or discard edits.
    act(() => {
      window.history.replaceState(
        null,
        '',
        '#record?as_of=2026-09-26&period_start=2026-08-21&memo=41',
      )
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(screen.getByText('3회')).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await user.click(screen.getByRole('button', { name: '변경 내용 검토' }))
    await user.click(screen.getByRole('button', { name: '다시 확정' }))
    await savedBack(user, 'write')
    expect(location.hash).toBe('#record?as_of=2026-09-26&period_start=2026-08-21')
    expect(changed).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole('button', { name: '지난 기록 찾기' }))
    expect(location.hash).toBe('#record?as_of=2026-09-26&period_start=2026-08-21&view=history')
    expect(changed).toHaveBeenCalledTimes(3)
    const history = within(screen.getByRole('complementary', { name: '최근 기록' }))
    await user.click(history.getByRole('button', { name: /2026년 9월 26일/ }))
    expect(location.hash).toBe(
      '#record?as_of=2026-09-26&period_start=2026-08-21&view=history&memo=41',
    )
    expect(changed).toHaveBeenCalledTimes(4)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  } finally {
    window.removeEventListener('hashchange', changed)
  }
})

it('빈 메모의 기본 기록 날짜는 자정·복귀 시 오늘로 갱신한다', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 27, 23, 59, 59))
  await act(async () => {
    render(<RecordPage health={health} />)
  })
  const date = screen.getByLabelText('기록 날짜') as HTMLInputElement
  expect(date.value).toBe('2026-09-27')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1200)
  })
  expect(date.value).toBe('2026-09-28')
  vi.setSystemTime(new Date(2026, 8, 29, 8))
  fireEvent.focus(window)
  expect(date.value).toBe('2026-09-29')
})

it.each(['past-date', 'draft'])(
  '직접 지정한 날짜나 작성 중인 메모는 자정·복귀에도 날짜를 보존한다 (%s)',
  async (kind) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 27, 23, 59, 59))
    await act(async () => {
      render(<RecordPage health={health} />)
    })
    const date = screen.getByLabelText('기록 날짜') as HTMLInputElement
    if (kind === 'past-date') fireEvent.change(date, { target: { value: '2026-09-25' } })
    else
      fireEvent.change(screen.getByLabelText('어떤 일이 있었나요?'), {
        target: { value: '작성 중인 원문' },
      })
    const original = date.value
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200)
    })
    fireEvent.focus(window)
    fireEvent(document, new Event('visibilitychange'))
    expect(date.value).toBe(original)
    if (kind === 'draft')
      expect((screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement).value).toBe(
        '작성 중인 원문',
      )
  },
)

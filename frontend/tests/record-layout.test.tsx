import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecordPage } from '../src/features/records/RecordPage'
import type { EventCard, Health, MemoResult } from '../src/api/types'

const api = vi.hoisted(() => ({
  questions: vi.fn(),
  memos: vi.fn(),
  createMemo: vi.fn(),
  confirmMemo: vi.fn(),
  retryMemo: vi.fn(),
  addEvent: vi.fn(),
  memoRevisions: vi.fn(),
  addQuestion: vi.fn(),
}))
vi.mock('../src/api', () => ({ api }))
const health: Health = {
  workspace_id: 'figma',
  ok: true,
  ai_available: true,
  model_name: 'test',
  allow_lan: false,
  emergency_keywords: [],
  emergency_message: '',
  ai_notice: 'AI가 정리한 내용이에요. 틀린 부분은 고쳐 주세요.',
  disclaimer: '',
}
const raw = '새벽에 두 번 깨셨어요. 낮에 불안해하세요.'
const events: EventCard[] = [
  {
    type: '야간 각성',
    status: '있었음',
    time_expr: '새벽',
    count: 2,
    evidence: '새벽에 두 번 깨셨어요.',
    model_event_index: 0,
  },
  {
    type: '불안',
    status: '있었음',
    time_expr: '낮에',
    count: 1,
    evidence: '낮에 불안해하세요.',
    model_event_index: 1,
  },
]
const memo: MemoResult = {
  memo_id: 50,
  record_date: '2026-09-27',
  text: raw,
  status: '확인 대기',
  events,
  emergency: { matched: false, message: null },
}
beforeEach(() => {
  vi.resetAllMocks()
  api.questions.mockResolvedValue([])
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 27, 12))
  window.history.replaceState(null, '', '#record?as_of=2026-09-27&period_start=2026-08-20')
  api.memos.mockResolvedValue([])
  api.memoRevisions.mockResolvedValue([])
  api.createMemo.mockResolvedValue(memo)
  api.confirmMemo.mockImplementation(async (_id, body) => {
    const saved = { ...memo, status: '확인 완료', events: body.events }
    api.memos.mockResolvedValue([saved])
    return saved
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  window.history.replaceState(null, '', '#record')
})

it('최근 기록의 더 보기에서 지난 기록을 열고 닫으면 목록과 빈 작성 화면으로 돌아간다', async () => {
  api.memos.mockResolvedValue([{ ...memo, status: '확인 완료' }])
  const user = userEvent.setup()
  render(<RecordPage health={health} />)
  const heading = screen.getByRole('heading', { level: 1, name: '오늘 하루는 어떠셨나요?' })
  heading.focus({ preventScroll: true })
  expect(document.activeElement).toBe(heading)
  expect(heading.tabIndex).toBe(-1)
  await user.click(
    within(screen.getByRole('region', { name: '최근 기록' })).getByRole('button', {
      name: '더 보기',
    }),
  )
  const history = within(screen.getByRole('complementary', { name: '최근 기록' }))
  await user.click(await history.findByRole('button', { name: /2026년 9월 27일/ }))
  const popup = await screen.findByRole('dialog', { name: '정리된 내용', exact: true })
  expect(screen.getByRole('heading', { level: 1, name: '지난 기록 찾기' })).toBeTruthy()
  expect(document.activeElement).toBe(
    within(popup).getByRole('heading', { name: '정리된 내용', exact: true }),
  )
  expect(within(popup).getByRole('heading', { name: '확인 완료한 내용' })).toBeTruthy()
  await user.click(within(popup).getByRole('button', { name: '닫기', exact: true }))
  expect(screen.queryByRole('dialog', { name: '정리된 내용', exact: true })).toBeNull()
  expect(screen.getByRole('heading', { level: 1, name: '지난 기록 찾기' })).toBeTruthy()
  expect(history.getByRole('button', { name: /2026년 9월 27일/ })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: '기록하기' }))
  expect(screen.getByRole('heading', { level: 1, name: '오늘 하루는 어떠셨나요?' })).toBeTruthy()
  expect((screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement).value).toBe('')
  expect((screen.getByLabelText('기록 날짜') as HTMLInputElement).value).toBe('2026-09-27')
  expect(screen.getByLabelText('어떤 일이 있었나요?').matches(':disabled')).toBe(false)
})

it('지난 기록에서 확인을 마치면 목록에 남고 다시 열 때 확정된 내용을 보여 준다', async () => {
  api.memos.mockResolvedValue([memo])
  const user = userEvent.setup()
  render(<RecordPage health={health} />)
  await user.click(screen.getByRole('button', { name: '지난 기록 찾기' }))
  const history = within(screen.getByRole('complementary', { name: '최근 기록' }))
  await user.click(await history.findByRole('button', { name: /2026년 9월 27일.*확인 대기/ }))
  const popup = screen.getByRole('dialog', { name: '정리된 내용', exact: true })
  await user.click(within(popup).getByRole('button', { name: '확인 완료' }))
  await user.click(
    within(await screen.findByRole('dialog', { name: '완료했어요' })).getByRole('button', {
      name: '확인',
    }),
  )
  expect(api.confirmMemo).toHaveBeenCalledExactlyOnceWith(50, { events })
  expect(screen.getByRole('heading', { level: 1, name: '지난 기록 찾기' })).toBeTruthy()
  expect(screen.queryByRole('dialog', { name: '정리된 내용', exact: true })).toBeNull()
  await user.click(history.getByRole('button', { name: /2026년 9월 27일.*확인 완료/ }))
  expect(screen.getByRole('heading', { name: '확인 완료한 내용' })).toBeTruthy()
  expect(screen.getByRole('heading', { level: 1, name: '지난 기록 찾기' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '확인 완료' })).toBeNull()
})

it('관찰 입력 아래 질문 카드를 두고 화면 이동 뒤에도 초안을 유지한다', async () => {
  const user = userEvent.setup()
  render(<RecordPage health={health} />)
  expect(screen.getByRole('heading', { level: 1, name: '오늘 하루는 어떠셨나요?' })).toBeTruthy()
  expect((screen.getByLabelText('기록 날짜') as HTMLInputElement).value).toBe('2026-09-27')
  expect(screen.queryByText('오늘', { exact: true })).toBeNull()
  expect(screen.queryByRole('button', { name: '오늘', exact: true })).toBeNull()
  expect(screen.queryByRole('group', { name: '기록 화면 선택' })).toBeNull()
  expect(screen.getByRole('button', { name: '지난 기록 찾기' }).className).toBe(
    'button outline mvp-rc-history-link',
  )
  const input = screen.getByRole('textbox', { name: '어떤 일이 있었나요?' })
  expect(screen.queryByRole('region', { name: '메모 정리 결과' })).toBeNull()
  expect(screen.queryByRole('heading', { name: '정리된 내용' })).toBeNull()
  const form = input.closest('form')!
  const question = screen.getByRole('region', { name: '의사에게 물어볼 것' })
  expect(form.compareDocumentPosition(question) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(within(question).queryByText('선택')).toBeNull()
  expect(within(question).getByRole('textbox', { name: '질문 메모' })).toBeTruthy()
  expect(screen.getAllByRole('textbox')).toHaveLength(2)
  expect(within(question).queryByRole('link', { name: '질문 목록 보기' })).toBeNull()
  await user.type(input, '작성 중인 원문')
  fireEvent.change(screen.getByLabelText('기록 날짜'), {
    target: { value: '2026-09-25' },
  })
  expect(screen.getByRole('heading', { level: 1, name: '지난날의 기록' })).toBeTruthy()
  expect(screen.queryByText('오늘', { exact: true })).toBeNull()
  act(() => {
    window.history.replaceState(
      null,
      '',
      '#schedule?tab=questions&as_of=2026-09-27&period_start=2026-08-20',
    )
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
  act(() => {
    window.history.replaceState(null, '', '#record?as_of=2026-09-27&period_start=2026-08-20')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
  expect((input as HTMLTextAreaElement).value).toBe('작성 중인 원문')
  expect((screen.getByLabelText('기록 날짜') as HTMLInputElement).value).toBe('2026-09-25')
  expect(api.addQuestion).not.toHaveBeenCalled()
  expect(api.createMemo).not.toHaveBeenCalled()
})

it('원문 다음에 모든 결과를 한 확인 영역에 보여 주고 같은 메모의 사건을 함께 승인한다', async () => {
  const user = userEvent.setup()
  render(<RecordPage health={health} />)
  await user.type(screen.getByLabelText('어떤 일이 있었나요?'), raw)
  await user.click(screen.getByRole('button', { name: '저장하고 정리하기' }))
  await screen.findByRole('heading', { level: 1, name: '확인·수정' })
  expect(screen.getByRole('region', { name: '메모 정리 결과' })).toBeTruthy()
  expect(screen.getByRole('region', { name: '의사에게 물어볼 것' })).toBeTruthy()
  const original = screen.getByRole('heading', { name: '작성한 메모' }).closest('section')!
  const review = screen.getByRole('heading', { name: /^정리된 내용 \d+건$/ }).closest('section')!
  expect(original.compareDocumentPosition(review) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(within(original).getByText(raw)).toBeTruthy()
  expect(within(original).getByRole('button', { name: '메모 수정' })).toBeTruthy()
  expect(within(original).queryByRole('button', { name: /삭제/ })).toBeNull()
  const recordActions = within(review).getByRole('group', { name: '기록 확인 및 삭제' })
  expect(within(recordActions).getAllByRole('button')).toHaveLength(2)
  expect(within(recordActions).getByRole('button', { name: '기록 삭제' })).toBeTruthy()
  expect(within(recordActions).getByRole('button', { name: '확인 완료' })).toBeTruthy()
  expect(within(review).getByRole('heading', { name: '야간 각성' })).toBeTruthy()
  expect(within(review).getByRole('heading', { name: '불안' })).toBeTruthy()
  expect(review.querySelector('input[type="date"]')).toBeNull()
  expect(within(review).getByText('새벽')).toBeTruthy()
  expect(within(review).getByText('2회')).toBeTruthy()
  expect(within(review).getByText('낮에')).toBeTruthy()
  const quotes = within(review).getAllByLabelText('근거 원문')
  expect(quotes.map((quote) => quote.querySelector('mark')?.textContent)).toEqual(
    events.map((event) => event.evidence),
  )
  expect(quotes[0].textContent).toContain(raw)
  expect(screen.queryByText(/일괄 승인 가능|개별 확인 필요/)).toBeNull()
  expect(screen.queryByRole('button', { name: '맞아요', exact: true })).toBeNull()
  await user.click(within(recordActions).getByRole('button', { name: '확인 완료' }))
  await screen.findByRole('heading', { level: 1, name: '오늘 하루는 어떠셨나요?' })
  expect(screen.queryByRole('region', { name: '메모 정리 결과' })).toBeNull()
  await user.click(
    within(screen.getByRole('dialog', { name: '완료했어요' })).getByRole('button', {
      name: '확인',
    }),
  )
  await user.click(
    within(screen.getByRole('region', { name: '최근 기록' })).getByRole('button', {
      name: /확인 완료/,
    }),
  )
  expect(api.confirmMemo).toHaveBeenCalledExactlyOnceWith(50, { events })
  expect(screen.getByRole('heading', { name: '야간 각성' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: '불안' })).toBeTruthy()
  expect(screen.getByText('새벽 · 2회')).toBeTruthy()
  expect(
    within(screen.getByRole('region', { name: '확인 완료한 사건' }))
      .getAllByLabelText('근거 원문')
      .map((quote) => quote.querySelector('mark')?.textContent),
  ).toEqual(events.map((event) => event.evidence))
  await user.click(screen.getByRole('button', { name: '확정 내용 수정' }))
  expect(screen.getByRole('heading', { level: 1, name: '오늘 하루는 어떠셨나요?' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: '확정 내용 수정' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: '수정 취소' }))
  expect(screen.getByRole('heading', { level: 1, name: '오늘 하루는 어떠셨나요?' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: '확인 완료한 내용' })).toBeTruthy()
})

it('정리 중에는 기록 찾기와 질문 입력을 잠그고 응답 실패 후 초안과 입력을 복구한다', async () => {
  let reject!: (error: Error) => void
  api.createMemo.mockImplementation(
    () =>
      new Promise((_resolve, failure) => {
        reject = failure
      }),
  )
  const user = userEvent.setup()
  render(<RecordPage health={health} />)
  await user.type(screen.getByLabelText('어떤 일이 있었나요?'), raw)
  await user.click(screen.getByRole('button', { name: '저장하고 정리하기' }))
  const questionInput = screen.getByRole('textbox', { name: '질문 메모' }) as HTMLTextAreaElement
  expect(
    within(screen.getByRole('region', { name: '메모 정리 결과' })).getByRole('status').textContent,
  ).toContain('정리하고 있어요')
  expect(questionInput.disabled).toBe(true)
  expect(
    (screen.getByRole('button', { name: '지난 기록 찾기' }) as HTMLButtonElement).disabled,
  ).toBe(true)
  expect((screen.getByRole('button', { name: '더 보기' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => {
    reject(new Error('응답 없음'))
  })
  await waitFor(() =>
    expect(screen.getByRole('alertdialog').textContent).toContain('입력한 내용은 남아 있어요'),
  )
  expect((screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement).value).toBe(raw)
  expect(screen.queryByRole('region', { name: '메모 정리 결과' })).toBeNull()
  expect(questionInput.disabled).toBe(false)
  expect(
    (screen.getByRole('button', { name: '지난 기록 찾기' }) as HTMLButtonElement).disabled,
  ).toBe(false)
  expect((screen.getByRole('button', { name: '더 보기' }) as HTMLButtonElement).disabled).toBe(
    false,
  )
  expect(api.addQuestion).not.toHaveBeenCalled()
})

it('분석 중 팝업을 닫고 다시 열어도 같은 요청을 유지하며 완료 결과를 보여 준다', async () => {
  let finish!: (result: MemoResult) => void
  api.createMemo.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const user = userEvent.setup()
  render(<RecordPage health={health} />)
  await user.type(screen.getByLabelText('어떤 일이 있었나요?'), raw)
  expect(screen.queryByRole('dialog', { name: '정리된 내용', exact: true })).toBeNull()
  await user.click(screen.getByRole('button', { name: '저장하고 정리하기' }))
  let resultDialog = screen.getByRole('dialog', { name: '정리된 내용', exact: true })
  expect(within(resultDialog).getByRole('status').textContent).toContain('정리하고 있어요')
  await user.click(within(resultDialog).getByRole('button', { name: '닫기', exact: true }))
  expect(screen.queryByRole('dialog', { name: '정리된 내용', exact: true })).toBeNull()
  expect((screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement).value).toBe(raw)
  expect(screen.getByLabelText('어떤 일이 있었나요?').matches(':disabled')).toBe(true)

  await user.click(screen.getByRole('button', { name: '정리 상태 보기' }))
  resultDialog = screen.getByRole('dialog', { name: '정리된 내용', exact: true })
  expect(within(resultDialog).getByRole('status').textContent).toContain('정리하고 있어요')
  expect(api.createMemo).toHaveBeenCalledTimes(1)
  await act(async () => finish(memo))
  expect(within(resultDialog).getByRole('heading', { name: '작성한 메모' })).toBeTruthy()
  expect(within(resultDialog).getByRole('heading', { name: '정리된 내용 2건' })).toBeTruthy()
  expect(within(resultDialog).queryByRole('status')).toBeNull()
  expect(api.createMemo).toHaveBeenCalledTimes(1)
})

it('질문을 독립 저장하면서 관찰 원문·기록 날짜을 보존하고 오늘 기록 날짜을 알린다', async () => {
  const question = '밤에 깨는 기록을 보아 주세요.\n진료 때 여쭤보고 싶어요.'
  api.addQuestion.mockResolvedValue({ id: 81, text: question, created_at: '2026-09-27T12:00:00' })
  const dirty: boolean[] = []
  const onDirty = (event: Event) => {
    const detail = (event as CustomEvent).detail
    if (detail.key === 'record') dirty.push(detail.dirty)
  }
  window.addEventListener('itda-final-dirty', onDirty)
  const user = userEvent.setup()
  render(<RecordPage health={health} />)
  await user.type(screen.getByLabelText('어떤 일이 있었나요?'), '아직 저장하지 않은 관찰 원문')
  fireEvent.change(screen.getByLabelText('기록 날짜'), {
    target: { value: '2026-09-25' },
  })
  await user.type(screen.getByLabelText('질문 메모'), question)
  await user.click(screen.getByRole('button', { name: '질문 저장', exact: true }))
  await screen.findByText('질문을 저장했어요.')
  expect(api.addQuestion).toHaveBeenCalledExactlyOnceWith({ text: question })
  expect(api.createMemo).not.toHaveBeenCalled()
  expect((screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement).value).toBe(
    '아직 저장하지 않은 관찰 원문',
  )
  expect((screen.getByLabelText('기록 날짜') as HTMLInputElement).value).toBe('2026-09-25')
  expect((screen.getByLabelText('질문 메모') as HTMLTextAreaElement).value).toBe('')
  expect(dirty.at(-1)).toBe(true)
  window.removeEventListener('itda-final-dirty', onDirty)
})

it('질문 저장은 중복 요청을 막고 실패한 원문을 남겨 같은 내용으로 재시도한다', async () => {
  let reject!: (error: Error) => void
  api.addQuestion.mockImplementationOnce(
    () =>
      new Promise((_resolve, failure) => {
        reject = failure
      }),
  )
  api.addQuestion.mockResolvedValueOnce({
    id: 82,
    text: '어제 일이 궁금해요',
    created_at: '2026-09-27T12:00:00',
  })
  const user = userEvent.setup()
  render(<RecordPage health={health} />)
  const input = screen.getByLabelText('질문 메모') as HTMLTextAreaElement
  await user.type(input, '어제 일이 궁금해요')
  const form = input.closest('form')!
  fireEvent.submit(form)
  fireEvent.submit(form)
  expect(api.addQuestion).toHaveBeenCalledTimes(1)
  expect(input.disabled).toBe(true)
  expect(
    (screen.getByRole('button', { name: '지난 기록 찾기' }) as HTMLButtonElement).disabled,
  ).toBe(true)
  expect(screen.queryByText('정리하고 있어요')).toBeNull()
  await act(async () => reject(new Error('질문 저장 연결 실패')))
  await screen.findByText('질문 저장 연결 실패')
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '확인' }))
  expect(input.value).toBe('어제 일이 궁금해요')
  await user.click(screen.getByRole('button', { name: '질문 저장', exact: true }))
  await screen.findByText('질문을 저장했어요.')
  expect(api.addQuestion.mock.calls).toEqual([
    [{ text: '어제 일이 궁금해요' }],
    [{ text: '어제 일이 궁금해요' }],
  ])
})

it('작성 중인 질문은 관찰 확인·확정 화면에도 남아 바로 이어 쓰고 저장한다', async () => {
  const user = userEvent.setup()
  render(<RecordPage health={health} />)
  await user.type(screen.getByLabelText('질문 메모'), '아직 덜 쓴 질문')
  await user.type(screen.getByLabelText('어떤 일이 있었나요?'), raw)
  await user.click(screen.getByRole('button', { name: '저장하고 정리하기' }))
  await screen.findByRole('button', { name: '확인 완료' })
  const question = screen.getByLabelText('질문 메모') as HTMLTextAreaElement
  expect(question.value).toBe('아직 덜 쓴 질문')
  expect(screen.getByRole('region', { name: '의사에게 물어볼 것' })).toBeTruthy()
  await user.clear(question)
  expect(screen.getByLabelText('질문 메모')).toBe(question)
  await user.type(question, '새로 정리한 질문')
  await user.click(screen.getByRole('button', { name: '확인 완료' }))
  await screen.findByRole('heading', { name: '오늘 하루는 어떠셨나요?' })
  await user.click(
    within(screen.getByRole('dialog', { name: '완료했어요' })).getByRole('button', {
      name: '확인',
    }),
  )
  expect(question.value).toBe('새로 정리한 질문')
  api.addQuestion
    .mockRejectedValueOnce(new Error('질문 저장 연결 실패'))
    .mockResolvedValueOnce({ id: 4, text: question.value, created_at: '2026-09-27' })
  await user.click(screen.getByRole('button', { name: '질문 저장', exact: true }))
  await screen.findByText('질문 저장 연결 실패')
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '확인' }))
  expect(question.value).toBe('새로 정리한 질문')
  await user.click(screen.getByRole('button', { name: '질문 저장', exact: true }))
  await screen.findByText('질문을 저장했어요.')
  expect(api.addQuestion.mock.calls).toEqual([
    [{ text: '새로 정리한 질문' }],
    [{ text: '새로 정리한 질문' }],
  ])
  expect(api.confirmMemo).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('region', { name: '의사에게 물어볼 것' })).toBeTruthy()
})

it.each([false, true])(
  '미저장 입력으로 과거 기록을 열 때 저장을 단정하지 않고 취소하면 초안으로 돌아온다 (응답 유실 %s)',
  async (lostResponse) => {
    const saved = { ...memo, status: '확인 완료' as const }
    api.memos.mockResolvedValue([saved])
    api.createMemo.mockRejectedValueOnce(new Error('응답 유실'))
    const user = userEvent.setup()
    render(<RecordPage health={health} />)
    await user.type(screen.getByLabelText('어떤 일이 있었나요?'), '저장 전 관찰 원문')
    await user.type(screen.getByLabelText('질문 메모'), '따로 이어 쓸 질문')
    if (lostResponse) {
      await user.click(screen.getByRole('button', { name: '저장하고 정리하기' }))
      await screen.findByText(/저장 여부를 확인하지 못했어요/)
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: '확인' }),
      )
    }
    await user.click(screen.getByRole('button', { name: '지난 기록 찾기' }))
    const history = within(screen.getByRole('complementary', { name: '최근 기록' }))
    const entry = await history.findByRole('button', { name: /2026년 9월 27일/ })
    await user.click(entry)
    const discard = screen.getByRole('alertdialog')
    expect(discard.textContent).toContain(
      lostResponse ? '저장 여부를 확인하지 못했어요' : '저장하지 않은 관찰 메모가 사라져요',
    )
    expect(discard.textContent).not.toContain('원문은 지난 기록에 남아요')
    await user.click(within(discard).getByRole('button', { name: '취소' }))
    await user.click(screen.getByRole('button', { name: '기록하기' }))
    expect((screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement).value).toBe(
      '저장 전 관찰 원문',
    )
    expect((screen.getByLabelText('질문 메모') as HTMLTextAreaElement).value).toBe(
      '따로 이어 쓸 질문',
    )
    await user.click(screen.getByRole('button', { name: '지난 기록 찾기' }))
    await user.click(entry)
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: '기록 열기' }),
    )
    const popup = await screen.findByRole('dialog', { name: '정리된 내용', exact: true })
    expect(screen.getByRole('heading', { level: 1, name: '지난 기록 찾기' })).toBeTruthy()
    expect(
      screen.getByRole('heading', { name: '작성한 메모' }).closest('section')?.textContent,
    ).toContain(raw)
    expect((screen.getByLabelText('질문 메모') as HTMLTextAreaElement).value).toBe(
      '따로 이어 쓸 질문',
    )
    await user.click(within(popup).getByRole('button', { name: '닫기', exact: true }))
    expect(screen.getByRole('heading', { level: 1, name: '지난 기록 찾기' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '기록하기' }))
    expect((screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement).value).toBe('')
    expect((screen.getByLabelText('질문 메모') as HTMLTextAreaElement).value).toBe(
      '따로 이어 쓸 질문',
    )
  },
)

it('한 번 고른 기록 날짜로 여러 사건을 확인하고 상세에서도 날짜를 중복 표시하지 않는다', async () => {
  const selected = '2026-09-25'
  const saved = { ...memo, record_date: selected, created_at: '2026-09-27T12:00:00' }
  api.createMemo.mockResolvedValue(saved)
  api.confirmMemo.mockImplementation(async (_id, body) => {
    const confirmed = { ...saved, status: '확인 완료', events: body.events }
    api.memos.mockResolvedValue([confirmed])
    return confirmed
  })
  const user = userEvent.setup()
  render(<RecordPage health={health} />)
  fireEvent.change(screen.getByLabelText('기록 날짜'), { target: { value: selected } })
  await user.type(screen.getByLabelText('어떤 일이 있었나요?'), raw)
  await user.click(screen.getByRole('button', { name: '저장하고 정리하기' }))
  const card = await screen.findByRole('region', { name: '2번 불안' })
  expect(card.querySelector('input[type="date"]')).toBeNull()
  expect(screen.queryByText(/날짜 미정|통계 제외/)).toBeNull()
  const original = screen.getByRole('heading', { name: '작성한 메모' }).closest('section')!
  expect(original.querySelector('time')?.dateTime).toBe(selected)
  expect(original.querySelectorAll('time')).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: '확인 완료' }))
  await screen.findByRole('heading', { level: 1, name: '오늘 하루는 어떠셨나요?' })
  await user.click(
    within(screen.getByRole('dialog', { name: '완료했어요' })).getByRole('button', {
      name: '확인',
    }),
  )
  await user.click(
    within(screen.getByRole('region', { name: '최근 기록' })).getByRole('button', {
      name: /확인 완료/,
    }),
  )
  expect(api.createMemo).toHaveBeenCalledExactlyOnceWith({
    text: raw,
    record_date: selected,
    request_id: expect.any(String),
  })
  expect(api.confirmMemo).toHaveBeenCalledExactlyOnceWith(50, { events })
  expect(screen.getByRole('region', { name: '확인 완료한 사건' }).querySelector('time')).toBeNull()
  expect(
    screen.getByRole('heading', { name: '작성한 메모' }).closest('section')?.querySelector('time')
      ?.dateTime,
  ).toBe(selected)
})

it('빈 메모는 오늘 날짜로 시작하고 달력에서 고른 과거 날짜를 원문과 함께 저장한다', async () => {
  const user = userEvent.setup()
  render(<RecordPage health={health} />)
  const input = screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement
  const date = screen.getByLabelText('기록 날짜') as HTMLInputElement
  expect(input.value).toBe('')
  expect(input.placeholder).toBe('새벽 3시쯤 깨서 현관문 열려고 하심.')
  expect(date.value).toBe('2026-09-27')
  expect(date.max).toBe('2026-09-27')
  expect(screen.queryByText('오늘', { exact: true })).toBeNull()
  expect(screen.queryByRole('button', { name: '오늘', exact: true })).toBeNull()
  expect(screen.queryByRole('button', { name: '어제', exact: true })).toBeNull()
  await user.type(input, raw)
  fireEvent.change(date, { target: { value: '2026-09-25' } })
  expect(screen.getByRole('heading', { name: '지난날의 기록' })).toBeTruthy()
  expect(screen.queryByText('오늘', { exact: true })).toBeNull()
  fireEvent.change(date, { target: { value: '' } })
  expect(screen.queryByText('오늘', { exact: true })).toBeNull()
  fireEvent.change(date, { target: { value: '2026-09-27' } })
  expect(date.value).toBe('2026-09-27')
  expect(screen.getByRole('heading', { name: '오늘 하루는 어떠셨나요?' })).toBeTruthy()
  expect(screen.queryByText('오늘', { exact: true })).toBeNull()
  fireEvent.change(date, { target: { value: '2026-09-25' } })
  expect(screen.queryByText('오늘', { exact: true })).toBeNull()
  await user.click(screen.getByRole('button', { name: '저장하고 정리하기' }))
  await waitFor(() =>
    expect(api.createMemo).toHaveBeenCalledWith({
      text: raw,
      record_date: '2026-09-25',
      request_id: expect.any(String),
    }),
  )
})

it('최근 기록에서 상태와 원문을 확인하고 기간 목록을 열지 않아도 메모를 재검토한다', async () => {
  api.memos.mockResolvedValue([{ ...memo, status: '확인 완료' }])
  const user = userEvent.setup()
  render(<RecordPage health={health} />)
  const recent = within(screen.getByRole('region', { name: '최근 기록' }))
  const open = await recent.findByRole('button', { name: /확인 완료/ })
  expect(open.textContent).toContain(raw)
  await user.click(open)
  await screen.findByRole('heading', { name: '확인 완료한 내용' })
  expect(screen.getByLabelText('어떤 일이 있었나요?').matches(':disabled')).toBe(true)
  expect(api.createMemo).not.toHaveBeenCalled()
})

it('최근 세 건만 미리 보여주고 더 보기와 작성 화면을 왕복해도 날짜·메모·질문 초안을 보존한다', async () => {
  api.memos.mockResolvedValue([
    { ...memo, memo_id: 30, record_date: '2026-09-25', text: '네 번째 기록' },
    memo,
    { ...memo, memo_id: 40, record_date: '2026-09-26', text: '세 번째 기록', status: '정리 실패' },
    { ...memo, memo_id: 60, text: '가장 최근 기록', status: '확인 완료' },
    { ...memo, memo_id: 10, record_date: '2026-09-21', text: '다섯 번째 기록' },
  ])
  const user = userEvent.setup()
  render(<RecordPage health={health} />)
  const recent = within(screen.getByRole('region', { name: '최근 기록' }))
  await recent.findByRole('button', { name: /가장 최근 기록/ })
  const preview = recent.getAllByRole('listitem')
  expect(preview).toHaveLength(3)
  expect(preview[0].textContent).toContain('가장 최근 기록')
  expect(preview[1].textContent).toContain(raw)
  expect(preview[2].textContent).toContain('세 번째 기록')
  expect(recent.queryByText('네 번째 기록')).toBeNull()
  expect(recent.queryByRole('button', { name: '최근 기록 새로고침' })).toBeNull()
  expect(recent.queryByRole('button', { name: '다시 불러오기' })).toBeNull()
  await user.type(screen.getByLabelText('어떤 일이 있었나요?'), '이어 작성할 관찰 메모')
  fireEvent.change(screen.getByLabelText('기록 날짜'), { target: { value: '2026-09-25' } })
  await user.type(screen.getByLabelText('질문 메모'), '이어 작성할 질문')
  const priorRequests = api.memos.mock.calls.length
  await user.click(recent.getByRole('button', { name: '더 보기' }))
  const history = within(screen.getByRole('complementary', { name: '최근 기록' }))
  await waitFor(() => expect(api.memos).toHaveBeenCalledTimes(priorRequests + 1))
  expect(screen.getByRole('heading', { level: 1, name: '지난 기록 찾기' })).toBeTruthy()
  expect(history.getAllByRole('listitem')).toHaveLength(5)
  expect(history.queryByRole('button', { name: '최근 기록 새로고침' })).toBeNull()
  expect(screen.queryByRole('alertdialog')).toBeNull()
  await user.click(history.getByRole('button', { name: '직접 선택' }))
  fireEvent.change(history.getByLabelText('시작일'), { target: { value: '2026-09-26' } })
  fireEvent.change(history.getByLabelText('종료일'), { target: { value: '2026-09-27' } })
  await user.selectOptions(history.getByLabelText('확인 상태'), '확인 완료')
  await user.click(screen.getByRole('button', { name: '기록하기' }))
  expect((screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement).value).toBe(
    '이어 작성할 관찰 메모',
  )
  expect((screen.getByLabelText('기록 날짜') as HTMLInputElement).value).toBe('2026-09-25')
  expect((screen.getByLabelText('질문 메모') as HTMLTextAreaElement).value).toBe('이어 작성할 질문')
  expect(window.location.hash).toContain('as_of=2026-09-27')
  expect(window.location.hash).toContain('period_start=2026-08-20')
  await user.click(recent.getByRole('button', { name: '더 보기' }))
  expect((history.getByLabelText('시작일') as HTMLInputElement).value).toBe('2026-09-26')
  expect((history.getByLabelText('종료일') as HTMLInputElement).value).toBe('2026-09-27')
  expect((history.getByLabelText('확인 상태') as HTMLSelectElement).value).toBe('확인 완료')
  expect(history.getAllByRole('listitem')).toHaveLength(1)
  expect(history.getByRole('button', { name: /가장 최근 기록/ })).toBeTruthy()
  expect(api.createMemo).not.toHaveBeenCalled()
})

it.each(['write', 'history'] as const)(
  '%s 목록 조회 실패 때만 다시 불러오기를 제공하고 재시도 중 중복 요청을 막는다',
  async (view) => {
    api.memos.mockRejectedValue(new Error('목록 연결 실패'))
    const user = userEvent.setup()
    render(<RecordPage health={health} />)
    await within(screen.getByRole('region', { name: '최근 기록' })).findByRole('button', {
      name: '다시 불러오기',
    })
    await user.type(screen.getByLabelText('어떤 일이 있었나요?'), '그대로 남을 메모')
    await user.type(screen.getByLabelText('질문 메모'), '그대로 남을 질문')
    fireEvent.change(screen.getByLabelText('기록 날짜'), { target: { value: '2026-09-25' } })
    if (view === 'history') await user.click(screen.getByRole('button', { name: '더 보기' }))
    const container = screen.getByRole(view === 'history' ? 'complementary' : 'region', {
      name: '최근 기록',
    })
    const controls = within(container)
    const retry = (await controls.findByRole('button', {
      name: '다시 불러오기',
    })) as HTMLButtonElement
    await waitFor(() => expect(retry.disabled).toBe(false))
    expect(controls.getByRole('alert').textContent).toContain('목록 연결 실패')
    let resolve!: (memos: MemoResult[]) => void
    api.memos.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const beforeRetry = api.memos.mock.calls.length
    fireEvent.click(retry)
    fireEvent.click(retry)
    expect(api.memos).toHaveBeenCalledTimes(beforeRetry + 1)
    expect(
      (controls.getByRole('button', { name: '불러오는 중…' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    await act(async () => resolve([memo]))
    expect(controls.queryByRole('alert')).toBeNull()
    expect(controls.queryByRole('button', { name: '다시 불러오기' })).toBeNull()
    expect(controls.getByRole('button', { name: /새벽에 두 번/ })).toBeTruthy()
    if (view === 'history') await user.click(screen.getByRole('button', { name: '기록하기' }))
    expect((screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement).value).toBe(
      '그대로 남을 메모',
    )
    expect((screen.getByLabelText('기록 날짜') as HTMLInputElement).value).toBe('2026-09-25')
    expect((screen.getByLabelText('질문 메모') as HTMLTextAreaElement).value).toBe(
      '그대로 남을 질문',
    )
    expect(api.createMemo).not.toHaveBeenCalled()
  },
)

it('관찰 메모는 서버 한도(1000자)까지만 입력되고 남은 글자를 알려 준다', async () => {
  render(<RecordPage health={health} />)
  const box = screen.getByRole('textbox', { name: '어떤 일이 있었나요?' })
  expect((box as HTMLTextAreaElement).maxLength).toBe(1000)
  expect(screen.queryByText(/ \/ 1000자$/)).toBeNull()
  fireEvent.change(box, { target: { value: '가'.repeat(950) } })
  expect(screen.getByText('950 / 1000자')).toBeTruthy()
})

it('주소에 #record가 없는 첫 화면에서도 지난 기록 찾기가 열린다', async () => {
  window.history.replaceState(null, '', '/')
  api.memos.mockResolvedValue([{ ...memo, status: '확인 완료' }])
  const user = userEvent.setup()
  render(<RecordPage health={health} />)
  await user.click(screen.getByRole('button', { name: '지난 기록 찾기' }))
  expect(await screen.findByRole('heading', { level: 1, name: '지난 기록 찾기' })).toBeTruthy()
  expect(window.location.hash).toBe('#record?view=history')
})

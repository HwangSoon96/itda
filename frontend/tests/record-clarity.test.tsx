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
  workspace_id: 'clarity',
  ok: true,
  ai_available: true,
  model_name: 'test',
  allow_lan: false,
  emergency_keywords: [],
  emergency_message: '',
  ai_notice: 'AI가 정리한 내용이에요. 틀린 부분은 고쳐 주세요.',
  disclaimer: '',
}
const observed: EventCard = {
  type: '야간 각성',
  status: '있었음',
  time_expr: '밤',
  count: 2,
  evidence: '밤에 두 번 깨셨어요.',
  model_event_index: 0,
}
const memo = (id: number, overrides: Partial<MemoResult> = {}): MemoResult => ({
  memo_id: id,
  record_date: '2026-09-27',
  text: `관찰 메모 ${id}`,
  status: '확인 완료',
  events: [],
  emergency: { matched: false, message: null },
  ...overrides,
})
beforeEach(() => {
  vi.resetAllMocks()
  api.questions.mockResolvedValue([])
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 27, 12))
  window.history.replaceState(null, '', '#record')
  api.memos.mockResolvedValue([])
  api.memoRevisions.mockResolvedValue([])
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  window.history.replaceState(null, '', '#record')
})
async function openHistory(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '지난 기록 찾기' }))
  const history = screen.getByRole('complementary', { name: '최근 기록' })
  await waitFor(() => expect(within(history).queryByText('기록을 불러오고 있어요.')).toBeNull())
  return within(history)
}

it('상단에서 목록에 바로 접근하고 작성 화면으로 돌아와도 입력과 기록 날짜을 보존한다', async () => {
  api.memos.mockResolvedValue([memo(1)])
  const user = userEvent.setup()
  render(<RecordPage health={health} />)
  await user.type(screen.getByLabelText('어떤 일이 있었나요?'), '쓰던 메모')
  fireEvent.change(screen.getByLabelText('기록 날짜'), {
    target: { value: '2026-09-25' },
  })
  const history = await openHistory(user)
  expect(history.getByRole('button', { name: '최근 7일' })).toBeTruthy()
  expect(history.getByRole('button', { name: '최근 30일' }).getAttribute('aria-pressed')).toBe(
    'true',
  )
  expect(history.getByRole('button', { name: '직접 선택' })).toBeTruthy()
  expect(screen.queryByRole('textbox', { name: '어떤 일이 있었나요?' })).toBeNull()
  await user.click(screen.getByRole('button', { name: '기록하기' }))
  expect((screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement).value).toBe(
    '쓰던 메모',
  )
  expect((screen.getByLabelText('기록 날짜') as HTMLInputElement).value).toBe('2026-09-25')
  expect(screen.getByLabelText('질문 메모')).toBeTruthy()
  expect(api.addQuestion).not.toHaveBeenCalled()
})

it('23개의 기록을 10개씩 탐색하고 상태를 바꾸면 첫 페이지로 돌아간다', async () => {
  api.memos.mockResolvedValue(
    Array.from({ length: 23 }, (_, index) =>
      memo(index + 1, { status: index === 0 ? '확인 대기' : '확인 완료' }),
    ),
  )
  const user = userEvent.setup()
  render(<RecordPage health={health} />)
  const history = await openHistory(user)
  const list = history.getByRole('list')
  expect(within(list).getAllByRole('listitem')).toHaveLength(10)
  expect(within(list).getByText('관찰 메모 23')).toBeTruthy()
  expect(within(list).queryByText('관찰 메모 13')).toBeNull()
  const topPages = within(history.getByRole('navigation', { name: '기록 목록 위쪽 페이지' }))
  await user.click(topPages.getByRole('button', { name: '다음 페이지' }))
  expect(within(list).getAllByRole('listitem')).toHaveLength(10)
  expect(within(list).getByText('관찰 메모 13')).toBeTruthy()
  await user.click(history.getByRole('button', { name: '다음' }))
  expect(within(list).getAllByRole('listitem')).toHaveLength(3)
  expect((history.getByRole('button', { name: '다음' }) as HTMLButtonElement).disabled).toBe(true)
  expect(
    (topPages.getByRole('button', { name: '다음 페이지' }) as HTMLButtonElement).disabled,
  ).toBe(true)
  await user.selectOptions(history.getByLabelText('확인 상태'), '확인 대기')
  expect(history.getByText('1개 기록 · 1 / 1페이지')).toBeTruthy()
  expect(within(list).getByText('관찰 메모 1')).toBeTruthy()
  expect(history.queryByRole('navigation', { name: '기록 목록 페이지' })).toBeNull()
})

it('최근 7일·30일 경계와 직접 선택 모두 기록 날짜만으로 찾고 저장 시각은 무시한다', async () => {
  api.memos.mockResolvedValue([
    memo(1, { text: '7일 경계', record_date: '2026-09-21' }),
    memo(2, { text: '8일 전', record_date: '2026-09-20' }),
    memo(3, { text: '30일 경계', record_date: '2026-08-29' }),
    memo(4, { text: '기간 밖', record_date: '2026-08-28' }),
    {
      ...memo(5, { text: '나중에 저장한 관찰', record_date: '2026-09-10', events: [observed] }),
      created_at: '2026-09-27T12:00:00',
    },
    memo(6, {
      text: '아직 확인하지 않은 관찰',
      status: '확인 대기',
      record_date: '2026-09-10',
      events: [observed],
    }),
    memo(7, {
      text: '다른 날짜의 관찰',
      record_date: '2026-09-27',
      events: [observed],
    }),
  ])
  const user = userEvent.setup()
  render(<RecordPage health={health} />)
  const history = await openHistory(user)
  expect(history.getByText('30일 경계')).toBeTruthy()
  expect(history.queryByText('기간 밖')).toBeNull()
  await user.click(history.getByRole('button', { name: '최근 7일' }))
  expect(history.getByText('7일 경계')).toBeTruthy()
  expect(history.queryByText('8일 전')).toBeNull()
  await user.click(history.getByRole('button', { name: '직접 선택' }))
  fireEvent.change(history.getByLabelText('시작일'), { target: { value: '2026-09-10' } })
  fireEvent.change(history.getByLabelText('종료일'), { target: { value: '2026-09-10' } })
  expect(history.getByText('나중에 저장한 관찰')).toBeTruthy()
  expect(history.getByText('아직 확인하지 않은 관찰')).toBeTruthy()
  expect(history.queryByText('다른 날짜의 관찰')).toBeNull()
  expect(history.getAllByText('2026년 9월 10일')).toHaveLength(2)
  expect(history.queryByText('2026년 9월 27일')).toBeNull()
  expect(history.queryByText(/찾은 발생일/)).toBeNull()
  fireEvent.change(history.getByLabelText('시작일'), { target: { value: '2026-09-11' } })
  expect(history.getByRole('alert').textContent).toContain('시작일이 종료일보다 늦어요')
  expect(history.queryAllByRole('listitem')).toHaveLength(0)
})

it('메모 링크는 목록 기간 밖의 기록도 열고 접힌 카드 전체를 한 번에 확인한다', async () => {
  const old = memo(8, {
    record_date: '2026-08-01',
    text: observed.evidence,
    status: '확인 대기',
    events: [observed, { ...observed, type: '불안', model_event_index: 1 }],
  })
  api.memos.mockResolvedValue([old])
  api.confirmMemo.mockImplementation(async (_id, body) => ({
    ...old,
    status: '확인 완료',
    events: body.events,
  }))
  window.history.replaceState(null, '', '#record?as_of=2026-08-02&memo=8')
  const user = userEvent.setup()
  render(<RecordPage health={health} />)
  await screen.findByRole('heading', { name: /^정리된 내용 \d+건$/ })
  expect(screen.getByRole('button', { name: '확인 완료' })).toBeTruthy()
  expect(screen.getByRole('dialog', { name: '정리된 내용', exact: true })).toBeTruthy()
  expect(screen.getAllByRole('button', { name: /^\d+번 .+ 수정$/ })).toHaveLength(2)
  expect(screen.getByRole('heading', { name: /야간 각성/ })).toBeTruthy()
  expect(screen.getByRole('heading', { name: /불안/ })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: '확인 완료' }))
  expect(api.confirmMemo).toHaveBeenCalledExactlyOnceWith(8, { events: old.events })
  expect(location.hash).toBe('#record?as_of=2026-08-02')
  expect(screen.getByRole('heading', { name: '오늘의 기록' })).toBeTruthy()
})

it('잘못된 값은 수정 창에서 적용하지 않고 취소하면 원래 카드로 돌아온다', async () => {
  api.memos.mockResolvedValue([
    memo(8, { text: observed.evidence, status: '확인 대기', events: [observed] }),
  ])
  window.history.replaceState(null, '', '#record?memo=8')
  const user = userEvent.setup()
  render(<RecordPage health={health} />)
  await user.click(await screen.findByLabelText('1번 야간 각성 수정'))
  const editor = within(screen.getByRole('dialog', { name: '내용 수정' }))
  fireEvent.change(editor.getByLabelText(/^횟수/), { target: { value: '0' } })
  await user.click(editor.getByRole('button', { name: '수정 적용' }))
  expect(editor.getByRole('alert').textContent).toContain('횟수는 1 이상의 정수')
  expect(api.confirmMemo).not.toHaveBeenCalled()
  await user.click(editor.getByRole('button', { name: '취소' }))
  expect(screen.queryByRole('dialog', { name: '내용 수정' })).toBeNull()
  expect(screen.getByRole('dialog', { name: '정리된 내용', exact: true })).toBeTruthy()
  expect(screen.getByText('2회')).toBeTruthy()
})

it.each([
  ['connection_error', '연결하지 못했어요'],
  ['model_not_found', '모델이 준비되지 않았어요'],
  ['timeout', '시간이 오래 걸려'],
  ['invalid_format', '읽을 수 있는 형식'],
  ['evidence_mismatch', '메모에 없는 내용을'],
  ['time_mismatch', '메모에 없는 시간 표현'],
  ['interrupted', '프로그램이 중단되어'],
  ['unknown_error', '실패 원인을 확인할 수 없어요'],
  [null, '이전 실패의 원인은 확인할 수 없어요'],
] as const)(
  '실패 원인 %s는 안전한 문구와 재시도·직접 정리 행동을 보여 준다',
  async (failure_code, reason) => {
    const failed = memo(9, {
      status: '정리 실패',
      error: '내부 서버 상세 오류 /private/raw/log',
      failure_code,
    })
    api.memos.mockResolvedValue([failed])
    window.history.replaceState(null, '', '#record?memo=9')
    render(<RecordPage health={health} />)
    const failure = (await screen.findByRole('heading', { name: '정리하지 못했어요' })).closest(
      'section',
    )!
    expect(failure.textContent).toContain(reason)
    expect(failure.textContent).toContain('원문은 저장되어 있어요')
    expect(within(failure).getByRole('button', { name: '다시 시도' })).toBeTruthy()
    const recordActions = within(screen.getByRole('group', { name: '기록 확인 및 삭제' }))
    expect(recordActions.getByRole('button', { name: '기록 삭제' })).toBeTruthy()
    expect(recordActions.getByRole('button', { name: '직접 정리' })).toBeTruthy()
    expect(screen.queryByText(failed.error!)).toBeNull()
    if (failure_code !== 'connection_error')
      expect(failure.textContent).not.toContain('연결하지 못했어요')
  },
)

it('지난 기록 수정 중 팝업을 닫으면 폐기 동의를 받고 취소하면 수정을 유지한다', async () => {
  api.memos.mockResolvedValue([
    memo(1, { text: observed.evidence, status: '확인 대기', events: [observed] }),
    memo(2),
  ])
  const user = userEvent.setup()
  render(<RecordPage health={health} />)
  const history = await openHistory(user)
  const row = history.getByRole('button', { name: /^2026년 .*밤에 두 번 깨셨어요/ })
  await user.click(row)
  await user.click(await screen.findByLabelText('1번 야간 각성 수정'))
  fireEvent.change(screen.getByLabelText(/^횟수/), { target: { value: '5' } })
  await user.click(screen.getByRole('button', { name: '수정 적용' }))
  const popup = screen.getByRole('dialog', { name: '정리된 내용', exact: true })
  await user.click(within(popup).getByRole('button', { name: '닫기', exact: true }))
  let discard = screen.getByRole('alertdialog', { name: '수정을 그만할까요?' })
  await user.click(within(discard).getByRole('button', { name: '취소' }))
  expect(screen.getByText('5회')).toBeTruthy()
  act(() => {
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
  expect(screen.getByText('5회')).toBeTruthy()
  expect(api.confirmMemo).not.toHaveBeenCalled()

  await user.click(within(popup).getByRole('button', { name: '닫기', exact: true }))
  discard = screen.getByRole('alertdialog', { name: '수정을 그만할까요?' })
  await user.click(within(discard).getByRole('button', { name: '수정 그만하기' }))
  expect(screen.queryByRole('dialog', { name: '정리된 내용', exact: true })).toBeNull()
  expect(screen.getByRole('heading', { level: 1, name: '지난 기록 찾기' })).toBeTruthy()
  await user.click(row)
  expect(screen.getByText('2회')).toBeTruthy()
  expect(screen.queryByText('5회')).toBeNull()
  expect(api.confirmMemo).not.toHaveBeenCalled()
})

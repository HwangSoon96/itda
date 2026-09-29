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
  deleteMemo: vi.fn(),
}))
vi.mock('../src/api', () => ({ api }))

const health: Health = {
  workspace_id: 'history-context',
  ok: true,
  ai_available: true,
  model_name: 'test',
  allow_lan: false,
  emergency_keywords: [],
  emergency_message: '',
  ai_notice: 'AI가 정리한 내용이에요.',
  disclaimer: '',
}
const observedEvent: EventCard = {
  type: '야간 각성',
  status: '있었음',
  time_expr: '새벽',
  count: 2,
  evidence: '새벽에 두 번 깨셨어요.',
  model_event_index: 0,
}
const historyHash = '#record?view=history&from=2026-09-01&to=2026-09-27'
let records: MemoResult[]

function memo(id: number, status: MemoResult['status'] = '확인 완료'): MemoResult {
  return {
    memo_id: id,
    record_date: '2026-09-15',
    text: `관찰 ${id}번. ${observedEvent.evidence}`,
    status,
    events: status === '정리 실패' ? [] : [{ ...observedEvent }],
    emergency: { matched: false, message: null },
    ...(status === '정리 실패' ? { failure_code: 'connection_error' as const } : {}),
  }
}
beforeEach(() => {
  vi.resetAllMocks()
  api.questions.mockResolvedValue([])
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-28T12:00:00+09:00'))
  window.history.replaceState(null, '', historyHash)
  records = [
    ...Array.from({ length: 24 }, (_, index) => memo(index + 1)),
    memo(501, '확인 대기'),
    memo(502, '정리 실패'),
  ]
  api.memos.mockImplementation(async () => records)
  api.memoRevisions.mockResolvedValue([])
  api.confirmMemo.mockImplementation(async (id: number, body: { events: EventCard[] }) => {
    const saved = { ...records.find((item) => item.memo_id === id)!, events: body.events }
    records = records.map((item) => (item.memo_id === id ? saved : item))
    return saved
  })
  api.deleteMemo.mockImplementation(async (id: number) => {
    records = records.filter((item) => item.memo_id !== id)
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  window.history.replaceState(null, '', '#record')
})

type User = ReturnType<typeof userEvent.setup>
const detail = () => screen.getByRole('dialog', { name: '정리된 내용', exact: true })
const list = () => within(screen.getByRole('complementary', { name: '최근 기록' }))
const composer = () => document.querySelector<HTMLTextAreaElement>('#record-text')!

async function openSecondPage(user: User) {
  render(<RecordPage health={health} />)
  await list().findByRole('button', { name: /관찰 24번/ })
  fireEvent.change(list().getByLabelText('시작일'), { target: { value: '2026-09-10' } })
  fireEvent.change(list().getByLabelText('종료일'), { target: { value: '2026-09-20' } })
  await user.selectOptions(list().getByLabelText('확인 상태'), '확인 완료')
  await user.click(list().getAllByRole('button', { name: '다음 페이지' })[0])
  await user.click(list().getByRole('button', { name: /관찰 14번/ }))
  await screen.findByRole('dialog', { name: '정리된 내용', exact: true })
}
function expectHistoryContext(count = 24) {
  expect(screen.getByRole('heading', { name: '지난 기록 찾기', level: 1 })).toBeTruthy()
  expect((list().getByLabelText('시작일') as HTMLInputElement).value).toBe('2026-09-10')
  expect((list().getByLabelText('종료일') as HTMLInputElement).value).toBe('2026-09-20')
  expect((list().getByLabelText('확인 상태') as HTMLSelectElement).value).toBe('확인 완료')
  expect(list().getByText(`${count}개 기록 · 2 / 3페이지`)).toBeTruthy()
  expect(window.location.hash).toContain('view=history')
  expect(composer().value).toBe('')
}
async function editCount(user: User) {
  await user.click(within(detail()).getByRole('button', { name: '확정 내용 수정' }))
  await user.click(within(detail()).getByRole('button', { name: '1번 야간 각성 수정' }))
  const editor = within(screen.getByRole('dialog', { name: '내용 수정' }))
  fireEvent.change(editor.getByLabelText(/^횟수/), { target: { value: '4' } })
  await user.click(editor.getByRole('button', { name: '수정 적용' }))
}
function goToRecordMenu() {
  act(() => {
    const oldURL = location.href
    window.history.replaceState(null, '', '#record')
    window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: location.href }))
  })
}

it.each(['닫기', '저장', '삭제'] as const)(
  '지난 기록 상세를 %s해도 목록의 기간·상태·2페이지를 유지하고 작성란은 비워 둔다',
  async (action) => {
    const user = userEvent.setup()
    await openSecondPage(user)
    expectHistoryContext()
    expect(window.location.hash).toContain('memo=14')
    expect(within(detail()).getByText('관찰 14번. 새벽에 두 번 깨셨어요.')).toBeTruthy()
    if (action === '닫기') {
      await user.click(within(detail()).getByRole('button', { name: '닫기', exact: true }))
    } else if (action === '저장') {
      await editCount(user)
      await user.click(within(detail()).getByRole('button', { name: '변경 내용 검토' }))
      await user.click(
        within(screen.getByRole('dialog', { name: '변경 내용 검토' })).getByRole('button', {
          name: '다시 확정',
        }),
      )
      expect(api.confirmMemo).toHaveBeenCalledExactlyOnceWith(14, {
        events: [{ ...observedEvent, count: 4 }],
      })
    } else {
      await user.click(within(detail()).getByRole('button', { name: '기록 삭제', exact: true }))
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', {
          name: '기록 삭제',
          exact: true,
        }),
      )
      expect(api.deleteMemo).toHaveBeenCalledExactlyOnceWith(14)
    }
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '정리된 내용' })).toBeNull())
    if (action !== '닫기') {
      await user.click(
        within(await screen.findByRole('dialog', { name: '완료했어요' })).getByRole('button', {
          name: '확인',
        }),
      )
    }
    await waitFor(() => expectHistoryContext(action === '삭제' ? 23 : 24))
    expect(window.location.hash).not.toContain('memo=')
    expect(api.createMemo).not.toHaveBeenCalled()
    expect(api.retryMemo).not.toHaveBeenCalled()
  },
)

it('수정한 지난 기록에서 기록 메뉴로 이동하면 확인하고 취소 시 상세, 승인 시 빈 작성 화면을 남긴다', async () => {
  const user = userEvent.setup()
  await openSecondPage(user)
  await editCount(user)
  goToRecordMenu()
  let confirmation = within(await screen.findByRole('alertdialog', { name: '수정을 그만할까요?' }))
  expect(window.location.hash).toContain('memo=14')
  expect(window.location.hash).toContain('view=history')
  await user.click(confirmation.getByRole('button', { name: '취소' }))
  expect(within(detail()).getByText('4회')).toBeTruthy()
  expectHistoryContext()
  goToRecordMenu()
  confirmation = within(await screen.findByRole('alertdialog', { name: '수정을 그만할까요?' }))
  await user.click(confirmation.getByRole('button', { name: '수정 그만하기' }))
  expect(screen.queryByRole('dialog', { name: '정리된 내용' })).toBeNull()
  expect(screen.getByRole('heading', { name: '오늘의 기록', level: 1 })).toBeTruthy()
  expect(composer().value).toBe('')
  expect(composer().matches(':disabled')).toBe(false)
  expect(window.location.hash).toBe('#record')
  expect(api.confirmMemo).not.toHaveBeenCalled()
  expect(api.createMemo).not.toHaveBeenCalled()
})

it('지난 메모 재시도 중 기록 메뉴 이동은 상세 주소로 복원하고 완료 뒤 목록으로 닫힌다', async () => {
  let finishRetry!: (result: MemoResult) => void
  api.retryMemo.mockImplementation(
    () =>
      new Promise<MemoResult>((resolve) => {
        finishRetry = resolve
      }),
  )
  const user = userEvent.setup()
  render(<RecordPage health={health} />)
  await user.click(await list().findByRole('button', { name: /관찰 502번/ }))
  await user.click(within(detail()).getByRole('button', { name: '다시 시도' }))
  goToRecordMenu()
  expect(window.location.hash).toContain('view=history')
  expect(window.location.hash).toContain('memo=502')
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(
    (within(detail()).getByRole('button', { name: '닫기' }) as HTMLButtonElement).disabled,
  ).toBe(true)
  await act(async () => {
    const retried = memo(502, '확인 대기')
    records = records.map((item) => (item.memo_id === 502 ? retried : item))
    finishRetry(retried)
  })
  expect(within(detail()).getByRole('button', { name: '확인 완료' })).toBeTruthy()
  await user.click(within(detail()).getByRole('button', { name: '닫기', exact: true }))
  expect(screen.queryByRole('dialog', { name: '정리된 내용' })).toBeNull()
  expect(screen.getByRole('heading', { name: '지난 기록 찾기', level: 1 })).toBeTruthy()
  expect(window.location.hash).not.toContain('memo=')
  expect(composer().value).toBe('')
  expect(api.retryMemo).toHaveBeenCalledExactlyOnceWith(502)
  expect(api.createMemo).not.toHaveBeenCalled()
})

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecordPage } from '../src/features/records/RecordPage'
import type { EventCard, MemoResult } from '../src/api/types'

const api = vi.hoisted(() => ({
  questions: vi.fn(),
  memos: vi.fn(),
  updateMemo: vi.fn(),
  confirmMemo: vi.fn(),
  memoRevisions: vi.fn(),
}))
vi.mock('../src/api', () => ({ api }))
const original: EventCard = {
  type: '야간 각성',
  status: '있었음',
  count: 2,
  time_expr: '새벽',
  evidence: '새벽에 두 번 깨셨어요.',
  model_event_index: 0,
}
const memo: MemoResult = {
  memo_id: 71,
  record_date: '2026-09-27',
  text: original.evidence,
  status: '확인 완료',
  events: [original],
  emergency: { matched: false, message: null },
}
const revised: EventCard = {
  ...original,
  type: '불안',
  count: 1,
  time_expr: '저녁',
  evidence: '저녁에 불안해하셨어요.',
}
const saved: MemoResult = {
  ...memo,
  text: revised.evidence,
  events: [revised],
  status: '확인 대기',
}
let records: MemoResult[]
beforeEach(() => {
  vi.resetAllMocks()
  api.questions.mockResolvedValue([])
  window.history.replaceState(null, '', '#record?view=history&memo=71')
  records = [structuredClone(memo)]
  api.memos.mockImplementation(async () => structuredClone(records))
  api.memoRevisions.mockResolvedValue([])
  api.updateMemo.mockImplementation(async () => {
    records = [structuredClone(saved)]
    return saved
  })
  api.confirmMemo.mockImplementation(async (_id, body) => {
    records = [{ ...records[0], events: body.events, status: '확인 완료' }]
    return records[0]
  })
})
afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '#record')
})
const detail = () => within(screen.getByRole('dialog', { name: '정리된 내용', exact: true }))
async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: '메모 수정', exact: true }))
  return within(screen.getByRole('dialog', { name: '메모 수정', exact: true }))
}

it.each(['확인 완료', '확인 대기', '정리 실패'] as const)(
  '%s 메모 원문을 같은 ID로 수정해 새 카드만 재확인하고 목록으로 돌아간다',
  async (status) => {
    records = [{ ...memo, status, events: status === '정리 실패' ? [] : memo.events }]
    const updates = vi.fn()
    window.addEventListener('itda-final-updated', updates)
    try {
      const user = userEvent.setup()
      render(<RecordPage health={null} />)
      const editor = await openEditor(user)
      expect((editor.getByLabelText('관찰 메모') as HTMLTextAreaElement).value).toBe(memo.text)
      fireEvent.change(editor.getByLabelText('관찰 메모'), { target: { value: saved.text } })
      await user.click(editor.getByRole('button', { name: '저장하고 다시 정리' }))
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: '메모 수정', exact: true })).toBeNull(),
      )
      expect(api.updateMemo).toHaveBeenCalledExactlyOnceWith(memo.memo_id, {
        text: saved.text,
        request_id: expect.any(String),
      })
      expect(detail().getByText(saved.text, { selector: '.mvp-rc-original p' })).toBeTruthy()
      expect(detail().getByRole('region', { name: '1번 불안' })).toBeTruthy()
      expect(detail().queryByRole('region', { name: '1번 야간 각성' })).toBeNull()
      expect(detail().getByText('9월 27일').getAttribute('datetime')).toBe(memo.record_date)
      expect(updates).toHaveBeenCalledTimes(1)
      await user.click(detail().getByRole('button', { name: '확인 완료' }))
      expect(api.confirmMemo).toHaveBeenCalledExactlyOnceWith(memo.memo_id, { events: [revised] })
      await user.click(
        within(screen.getByRole('dialog', { name: '완료했어요' })).getByRole('button', {
          name: '확인',
        }),
      )
      expect(screen.getByRole('heading', { level: 1, name: '지난 기록 찾기' })).toBeTruthy()
      expect(screen.queryByRole('dialog', { name: '정리된 내용', exact: true })).toBeNull()
      expect(
        within(screen.getByRole('complementary', { name: '최근 기록' })).getByText(saved.text),
      ).toBeTruthy()
    } finally {
      window.removeEventListener('itda-final-updated', updates)
    }
  },
)

it('원문 수정을 취소하면 원문과 아직 저장하지 않은 카드 수정을 모두 유지한다', async () => {
  records = [{ ...memo, status: '확인 대기' }]
  const user = userEvent.setup()
  render(<RecordPage health={null} />)
  await user.click(await screen.findByRole('button', { name: '1번 야간 각성 수정' }))
  const eventEditor = within(screen.getByRole('dialog', { name: '내용 수정' }))
  fireEvent.change(eventEditor.getByLabelText(/^횟수/), { target: { value: '4' } })
  await user.click(eventEditor.getByRole('button', { name: '수정 적용' }))
  const editor = await openEditor(user)
  fireEvent.change(editor.getByLabelText('관찰 메모'), { target: { value: saved.text } })
  await user.click(editor.getByRole('button', { name: '취소' }))
  expect(detail().getByText(memo.text, { selector: '.mvp-rc-original p' })).toBeTruthy()
  expect(detail().getByText('4회')).toBeTruthy()
  expect(api.updateMemo).not.toHaveBeenCalled()
  await user.click(detail().getByRole('button', { name: '확인 완료' }))
  expect(api.confirmMemo).toHaveBeenCalledExactlyOnceWith(memo.memo_id, {
    events: [{ ...original, count: 4 }],
  })
})

it('변경 없는 원문은 재정리하지 않고 빈 원문은 저장할 수 없다', async () => {
  const user = userEvent.setup()
  render(<RecordPage health={null} />)
  const editor = await openEditor(user)
  expect(
    (editor.getByRole('button', { name: '저장하고 다시 정리' }) as HTMLButtonElement).disabled,
  ).toBe(true)
  fireEvent.change(editor.getByLabelText('관찰 메모'), { target: { value: '  ' } })
  await user.click(editor.getByRole('button', { name: '저장하고 다시 정리' }))
  expect(editor.getByRole('alert').textContent).toBe('관찰한 내용을 적어 주세요.')
  expect(api.updateMemo).not.toHaveBeenCalled()
})

it('저장 응답 실패 시 수정 원문을 유지하고 같은 요청 번호로 다시 저장한다', async () => {
  api.updateMemo.mockRejectedValueOnce(new Error('연결이 끊겼어요.'))
  const user = userEvent.setup()
  render(<RecordPage health={null} />)
  const editor = await openEditor(user)
  fireEvent.change(editor.getByLabelText('관찰 메모'), { target: { value: saved.text } })
  await user.click(editor.getByRole('button', { name: '저장하고 다시 정리' }))
  expect(editor.getByRole('alert').textContent).toContain('수정한 내용은 남아 있어요.')
  expect((editor.getByLabelText('관찰 메모') as HTMLTextAreaElement).value).toBe(saved.text)
  expect(api.confirmMemo).not.toHaveBeenCalled()
  const firstRequest = api.updateMemo.mock.calls[0]
  await user.click(editor.getByRole('button', { name: '저장하고 다시 정리' }))
  expect(api.updateMemo.mock.calls[1]).toEqual(firstRequest)
  expect(detail().getByRole('region', { name: '1번 불안' })).toBeTruthy()
})

it('재정리 실패 시 새 원문을 보관하고 이전 사건 대신 직접 정리와 재시도를 제공한다', async () => {
  const failed: MemoResult = {
    ...saved,
    status: '정리 실패',
    events: [],
    failure_code: 'invalid_format',
  }
  api.updateMemo.mockImplementation(async () => {
    records = [failed]
    return failed
  })
  const user = userEvent.setup()
  render(<RecordPage health={null} />)
  const editor = await openEditor(user)
  fireEvent.change(editor.getByLabelText('관찰 메모'), { target: { value: saved.text } })
  await user.click(editor.getByRole('button', { name: '저장하고 다시 정리' }))
  expect(detail().getByText(saved.text, { selector: '.mvp-rc-original p' })).toBeTruthy()
  expect(detail().getByRole('heading', { name: '정리하지 못했어요' })).toBeTruthy()
  expect(detail().getByRole('button', { name: '직접 정리' })).toBeTruthy()
  expect(detail().queryByRole('region', { name: '확인 완료한 사건' })).toBeNull()
})

it('재정리 중에는 원문 편집·중복 저장·닫기를 막는다', async () => {
  let finish!: (memo: MemoResult) => void
  api.updateMemo.mockImplementation(
    () =>
      new Promise<MemoResult>((resolve) => {
        finish = resolve
      }),
  )
  const user = userEvent.setup()
  render(<RecordPage health={null} />)
  const editor = await openEditor(user)
  fireEvent.change(editor.getByLabelText('관찰 메모'), { target: { value: saved.text } })
  await user.click(editor.getByRole('button', { name: '저장하고 다시 정리' }))
  expect((editor.getByLabelText('관찰 메모') as HTMLTextAreaElement).disabled).toBe(true)
  expect((editor.getByRole('button', { name: '닫기' }) as HTMLButtonElement).disabled).toBe(true)
  expect((editor.getByRole('button', { name: '취소' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent(
    screen.getByRole('dialog', { name: '메모 수정', exact: true }),
    new Event('cancel', { cancelable: true }),
  )
  await user.click(editor.getByRole('button', { name: '다시 정리하고 있어요' }))
  expect(api.updateMemo).toHaveBeenCalledTimes(1)
  await act(async () => finish(saved))
  expect(screen.queryByRole('dialog', { name: '메모 수정', exact: true })).toBeNull()
})

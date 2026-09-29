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
  updateMemo: vi.fn(),
  addEvent: vi.fn(),
  memoRevisions: vi.fn(),
  addQuestion: vi.fn(),
  deleteMemo: vi.fn(),
}))
vi.mock('../src/api', () => ({ api }))

const health: Health = {
  workspace_id: 'print-return',
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
  time_expr: '새벽',
  count: 2,
  evidence: '새벽에 두 번 깨셨어요.',
  model_event_index: 0,
}
const memo: MemoResult = {
  memo_id: 41,
  record_date: '2026-09-20',
  text: event.evidence,
  status: '확인 대기',
  events: [event],
  emergency: { matched: false, message: null },
}
const sourceHash =
  '#record?memo=41&return_to=summary-print&as_of=2026-09-27&period_start=2026-09-01'
type User = ReturnType<typeof userEvent.setup>
let records: MemoResult[]

function changeHash(hash: string) {
  const oldURL = location.href
  window.history.replaceState(null, '', hash)
  window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: location.href }))
}
const route = () => location.hash.slice(1).split('?')[0]
const query = () => new URLSearchParams(location.hash.split('?')[1] ?? '')
const detail = () => within(screen.getByRole('dialog', { name: '정리된 내용', exact: true }))
async function openRecord() {
  const mounted = render(<RecordPage health={health} />)
  await screen.findByRole('dialog', { name: '정리된 내용', exact: true })
  return mounted
}
async function beginAction(user: User, action: '확인 완료' | '기록 삭제') {
  await user.click(detail().getByRole('button', { name: action, exact: true }))
  if (action === '기록 삭제')
    await user.click(
      within(screen.getByRole('alertdialog', { name: '이 기록을 삭제할까요?' })).getByRole(
        'button',
        { name: '기록 삭제', exact: true },
      ),
    )
}
async function finishFeedback(user: User) {
  await user.click(
    within(await screen.findByRole('dialog', { name: '완료했어요' })).getByRole('button', {
      name: '확인',
    }),
  )
}
function expectPrintReturn(periodStart = '2026-09-01') {
  expect(route()).toBe('summary')
  expect(Object.fromEntries(query())).toEqual({
    review: 'print',
    as_of: '2026-09-27',
    ...(periodStart ? { period_start: periodStart } : {}),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  api.questions.mockResolvedValue([])
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-28T12:00:00+09:00'))
  window.history.replaceState(null, '', sourceHash)
  records = [structuredClone(memo)]
  api.memos.mockImplementation(async () => structuredClone(records))
  api.memoRevisions.mockResolvedValue([])
  api.deleteMemo.mockImplementation(async (id: number) => {
    records = records.filter((item) => item.memo_id !== id)
  })
  api.confirmMemo.mockImplementation(async (id: number, body: { events: EventCard[] }) => {
    const saved = {
      ...records.find((item) => item.memo_id === id)!,
      status: '확인 완료' as const,
      events: body.events,
    }
    records = records.map((item) => (item.memo_id === id ? saved : item))
    return saved
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  window.history.replaceState(null, '', '#record')
})

it.each(['2026-09-01', ''])(
  '출력 검토에서 연 상세를 닫으면 선택한 기간을 유지한 요약지로 돌아간다 (시작일 %s)',
  async (periodStart) => {
    if (!periodStart)
      window.history.replaceState(
        null,
        '',
        '#record?memo=41&return_to=summary-print&as_of=2026-09-27',
      )
    const user = userEvent.setup()
    await openRecord()
    await user.click(detail().getByRole('button', { name: '닫기', exact: true }))
    await waitFor(() => expectPrintReturn(periodStart))
    expect(screen.queryByRole('dialog', { name: '정리된 내용', exact: true })).toBeNull()
    expect(api.deleteMemo).not.toHaveBeenCalled()
    expect(api.confirmMemo).not.toHaveBeenCalled()
  },
)

it.each(['확인 완료', '기록 삭제'] as const)(
  '출력 검토에서 연 기록의 %s 성공은 안내를 확인한 다음 같은 요약지로 돌아간다',
  async (action) => {
    const user = userEvent.setup()
    await openRecord()
    await beginAction(user, action)
    await screen.findByRole('dialog', { name: '완료했어요' })
    expect(route()).toBe('record')
    expect(screen.queryByRole('dialog', { name: '정리된 내용', exact: true })).toBeNull()
    if (action === '기록 삭제') expect(api.deleteMemo).toHaveBeenCalledExactlyOnceWith(memo.memo_id)
    else expect(api.confirmMemo).toHaveBeenCalledExactlyOnceWith(memo.memo_id, { events: [event] })
    await finishFeedback(user)
    await waitFor(() => expectPrintReturn())
  },
)

it('삭제 취소와 실패는 출처 기록을 유지하며 이후 삭제 성공을 확인해야 돌아간다', async () => {
  const user = userEvent.setup()
  api.deleteMemo.mockRejectedValueOnce(new Error('삭제 연결 실패'))
  await openRecord()
  await user.click(detail().getByRole('button', { name: '기록 삭제' }))
  await user.click(
    within(screen.getByRole('alertdialog', { name: '이 기록을 삭제할까요?' })).getByRole('button', {
      name: '취소',
    }),
  )
  expect(api.deleteMemo).not.toHaveBeenCalled()
  expect(route()).toBe('record')
  expect(query().get('memo')).toBe('41')
  expect(query().get('return_to')).toBe('summary-print')
  expect(detail().getByRole('heading', { name: '작성한 메모' })).toBeTruthy()
  await beginAction(user, '기록 삭제')
  const error = within(await screen.findByRole('alertdialog', { name: '다시 확인해 주세요' }))
  expect(error.getByText(/삭제 연결 실패/)).toBeTruthy()
  await user.click(error.getByRole('button', { name: '확인' }))
  expect(route()).toBe('record')
  expect(query().get('memo')).toBe('41')
  expect(query().get('return_to')).toBe('summary-print')
  expect(detail().getByRole('heading', { name: '작성한 메모' })).toBeTruthy()
  await beginAction(user, '기록 삭제')
  await finishFeedback(user)
  expect(api.deleteMemo).toHaveBeenCalledTimes(2)
  await waitFor(() => expectPrintReturn())
})

it.each(['summary', 'unknown', 'https://example.com'])(
  '허용하지 않은 return_to=%s는 메모를 닫아도 화면 이동에 사용하지 않는다',
  async (returnTo) => {
    const params = new URLSearchParams({
      memo: '41',
      return_to: returnTo,
      as_of: '2026-09-27',
      period_start: '2026-09-01',
    })
    window.history.replaceState(null, '', `#record?${params}`)
    const user = userEvent.setup()
    await openRecord()
    await user.click(detail().getByRole('button', { name: '닫기', exact: true }))
    expect(route()).toBe('record')
    expect(query().has('memo')).toBe(false)
    expect(screen.getByRole('heading', { name: '오늘 하루는 어떠셨나요?', level: 1 })).toBeTruthy()
  },
)

it.each(['다시 시도', '메모 수정'] as const)(
  '%s 응답은 새 내용을 검토하도록 상세에 남고 사용자가 닫을 때 출력 검토로 돌아간다',
  async (action) => {
    const revisedEvent = { ...event, count: 3, evidence: '새벽에 세 번 깨셨어요.' }
    const revised = { ...memo, text: revisedEvent.evidence, events: [revisedEvent] }
    if (action === '다시 시도')
      records = [{ ...memo, status: '정리 실패', events: [], failure_code: 'connection_error' }]
    const replaceMemo = async () => {
      records = [revised]
      return revised
    }
    api.retryMemo.mockImplementation(replaceMemo)
    api.updateMemo.mockImplementation(replaceMemo)
    const user = userEvent.setup()
    await openRecord()
    await user.click(detail().getByRole('button', { name: action, exact: true }))
    if (action === '메모 수정') {
      const editor = within(screen.getByRole('dialog', { name: '메모 수정', exact: true }))
      fireEvent.change(editor.getByLabelText('관찰 메모'), { target: { value: revised.text } })
      await user.click(editor.getByRole('button', { name: '저장하고 다시 정리' }))
    }
    await waitFor(() =>
      expect(detail().getByRole('region', { name: '1번 야간 각성' }).textContent).toContain('3회'),
    )
    expect(route()).toBe('record')
    expect(query().get('memo')).toBe('41')
    expect(query().get('return_to')).toBe('summary-print')
    expect(api.confirmMemo).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: '완료했어요' })).toBeNull()
    await user.click(detail().getByRole('button', { name: '닫기', exact: true }))
    await waitFor(() => expectPrintReturn())
  },
)

it.each(['확인 완료', '기록 삭제'] as const)(
  '%s 중 다른 화면으로 떠나면 늦은 저장 응답이나 안내가 출력 검토로 돌려보내지 않는다',
  async (action) => {
    let resolve!: (value: MemoResult | void) => void
    const deferred = new Promise<MemoResult | void>((done) => {
      resolve = done
    })
    if (action === '기록 삭제') api.deleteMemo.mockImplementationOnce(() => deferred)
    else api.confirmMemo.mockImplementationOnce(() => deferred)
    const user = userEvent.setup()
    const mounted = await openRecord()
    await beginAction(user, action)
    act(() => changeHash('#schedule?as_of=2026-09-27&period_start=2026-09-01'))
    mounted.rerender(<RecordPage health={health} active={false} />)
    await act(async () => {
      const confirmed = { ...memo, status: '확인 완료' as const }
      records = action === '기록 삭제' ? [] : [confirmed]
      resolve(action === '기록 삭제' ? undefined : confirmed)
    })
    expect(route()).toBe('schedule')
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => changeHash('#record'))
    mounted.rerender(<RecordPage health={health} />)
    await finishFeedback(user)
    expect(route()).toBe('record')
    expect(query().get('review')).not.toBe('print')
    expect(screen.getByRole('heading', { name: '오늘 하루는 어떠셨나요?', level: 1 })).toBeTruthy()
  },
)

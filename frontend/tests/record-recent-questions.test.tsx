import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecordPage } from '../src/features/records/RecordPage'
import type { Question } from '../src/api/types'

const api = vi.hoisted(() => ({
  memos: vi.fn(),
  questions: vi.fn(),
  addQuestion: vi.fn(),
}))
vi.mock('../src/api', () => ({ api }))

const original: Question[] = [
  { id: 1, text: '가장 오래된 질문', created_at: '2026-08-31' },
  { id: 2, text: '아침에 저장한 질문', created_at: '2026-09-27T08:00:00' },
  { id: 3, text: '저녁에 저장한 질문', created_at: '2026-09-27T18:00:00' },
  {
    id: 4,
    text: '첫 번째 질문입니다.\n\n두 번째 질문도 함께 봐 주세요.',
    created_at: '2026-09-27T18:00:00',
  },
]
const newQuestion: Question = {
  id: 5,
  text: '새로 저장한 질문',
  created_at: '2026-09-28T12:00:00',
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
const input = () => screen.getByRole('textbox', { name: '질문 메모' }) as HTMLTextAreaElement
const disclosure = () => screen.getByText('최근 질문', { exact: true }).closest('details')!
const preview = () => screen.getByRole('list', { name: '최근 질문 목록' })
const contents = () =>
  within(preview())
    .getAllByRole('listitem')
    .map((item) => item.querySelector('p')!.textContent)
const updated = () => window.dispatchEvent(new Event('itda-final-updated'))
async function openPreview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText('최근 질문', { exact: true }))
  await screen.findByRole('list', { name: '최근 질문 목록' })
}
async function closeFeedback(user: ReturnType<typeof userEvent.setup>, error = false) {
  await user.click(
    within(await screen.findByRole(error ? 'alertdialog' : 'dialog')).getByRole('button', {
      name: '확인',
    }),
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 28, 12))
  window.history.replaceState(null, '', '#record')
  api.memos.mockResolvedValue([])
  api.questions.mockResolvedValue(structuredClone(original))
  api.addQuestion.mockResolvedValue(newQuestion)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it('최근 질문은 기본 접힘이며 펼치면 최신 3개의 원문·날짜를 보존하고 재조회해도 접기 선택을 유지한다', async () => {
  const user = userEvent.setup()
  const mounted = render(<RecordPage health={null} />)
  expect(disclosure().open).toBe(false)
  await openPreview(user)
  expect(contents()).toEqual([original[3].text, original[2].text, original[1].text])
  expect(within(preview()).queryByText(original[0].text)).toBeNull()
  const questionCard = screen.getByRole('region', { name: '의사에게 물어볼 것' })
  const recent = disclosure()
  expect(questionCard.contains(recent)).toBe(true)
  expect(input().compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  const dates = [...preview().querySelectorAll('time')]
  expect(dates.map((date) => date.dateTime)).toEqual([
    original[3].created_at,
    original[2].created_at,
    original[1].created_at,
  ])
  expect(dates.map((date) => date.textContent)).toEqual(['9월 27일', '9월 27일', '9월 27일'])
  expect(within(preview()).queryByRole('button')).toBeNull()
  expect(within(preview()).queryByRole('link')).toBeNull()
  expect(within(preview()).queryByRole('textbox')).toBeNull()
  expect(api.questions).toHaveBeenCalledTimes(1)
  await user.click(screen.getByText('최근 질문', { exact: true }))
  expect(disclosure().open).toBe(false)
  await act(async () => updated())
  expect(api.questions).toHaveBeenCalledTimes(2)
  expect(disclosure().open).toBe(false)
  mounted.unmount()
  render(<RecordPage health={null} />)
  expect(disclosure().open).toBe(false)
})

it('첫 조회 상태를 표시하고 실패하면 입력을 보존한 채 중복 요청 없이 다시 불러온다', async () => {
  const initial = deferred<Question[]>()
  const retry = deferred<Question[]>()
  api.questions.mockReturnValueOnce(initial.promise).mockReturnValueOnce(retry.promise)
  const user = userEvent.setup()
  render(<RecordPage health={null} />)
  expect(disclosure().open).toBe(false)
  await user.click(screen.getByText('최근 질문', { exact: true }))
  expect(screen.getByText('질문을 불러오고 있어요.')).toBeTruthy()
  expect(screen.queryByRole('list', { name: '최근 질문 목록' })).toBeNull()
  await user.type(input(), '아직 작성 중인 질문')
  await act(async () => initial.reject(new Error('조회 연결 실패')))
  expect(screen.getByText('저장한 질문을 불러오지 못했어요. 조회 연결 실패')).toBeTruthy()
  expect(screen.queryByText('질문을 불러오고 있어요.')).toBeNull()
  const reload = screen.getByRole('button', { name: '질문 다시 불러오기' })
  fireEvent.click(reload)
  fireEvent.click(reload)
  expect(api.questions).toHaveBeenCalledTimes(2)
  expect((reload as HTMLButtonElement).disabled).toBe(true)
  await act(async () => retry.resolve(original))
  expect(contents()).toEqual([original[3].text, original[2].text, original[1].text])
  expect(input().value).toBe('아직 작성 중인 질문')
  expect(screen.queryByRole('button', { name: '질문 다시 불러오기' })).toBeNull()
  expect(screen.queryByText(/저장한 질문을 불러오지 못했어요/)).toBeNull()
})

it('저장 응답은 즉시 표시하고 저장 전에 시작한 늦은 조회가 새 질문을 지우지 못한다', async () => {
  const initial = deferred<Question[]>()
  const refresh = deferred<Question[]>()
  api.questions.mockReturnValueOnce(initial.promise).mockReturnValueOnce(refresh.promise)
  const user = userEvent.setup()
  render(<RecordPage health={null} />)
  fireEvent.change(screen.getByLabelText('기록 날짜'), { target: { value: '2026-09-25' } })
  await user.type(screen.getByLabelText('어떤 일이 있었나요?'), '아직 저장하지 않은 관찰 메모')
  await user.type(input(), newQuestion.text)
  await user.click(screen.getByRole('button', { name: '질문 저장', exact: true }))
  await screen.findByText('질문을 저장했어요.')
  expect(api.addQuestion).toHaveBeenCalledExactlyOnceWith({ text: newQuestion.text })
  expect(api.questions).toHaveBeenCalledTimes(2)
  expect(disclosure().open).toBe(true)
  expect(contents()).toEqual([newQuestion.text])
  await closeFeedback(user)
  expect(input().value).toBe('')
  expect((screen.getByLabelText('기록 날짜') as HTMLInputElement).value).toBe('2026-09-25')
  expect((screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement).value).toBe(
    '아직 저장하지 않은 관찰 메모',
  )
  await act(async () => initial.resolve(original))
  expect(contents()).toEqual([newQuestion.text])
  await act(async () => refresh.resolve([...original, newQuestion]))
  expect(contents()).toEqual([newQuestion.text, original[3].text, original[2].text])
  expect(within(preview()).getAllByText(newQuestion.text)).toHaveLength(1)
})

it('다른 화면의 변경을 재조회하며 조회 실패 때 기존 질문을 유지하고 재시도 결과로 갱신한다', async () => {
  const refresh = deferred<Question[]>()
  api.questions.mockResolvedValueOnce(original).mockReturnValueOnce(refresh.promise)
  const user = userEvent.setup()
  render(<RecordPage health={null} />)
  await openPreview(user)
  await user.type(input(), '조회 중에도 보존할 질문')
  act(updated)
  expect(api.questions).toHaveBeenCalledTimes(2)
  expect(contents()).toEqual([original[3].text, original[2].text, original[1].text])
  await act(async () => refresh.reject(new Error('갱신 연결 실패')))
  expect(contents()).toEqual([original[3].text, original[2].text, original[1].text])
  expect(screen.getByText('저장한 질문을 불러오지 못했어요. 갱신 연결 실패')).toBeTruthy()
  api.questions.mockResolvedValue([original[0], original[1]])
  await user.click(screen.getByRole('button', { name: '질문 다시 불러오기' }))
  await waitFor(() => expect(contents()).toEqual([original[1].text, original[0].text]))
  expect(input().value).toBe('조회 중에도 보존할 질문')
  expect(screen.queryByText(/저장한 질문을 불러오지 못했어요/)).toBeNull()
})

it('질문 저장 실패는 초안과 미리보기를 보존하고 재저장 후 새 질문을 맨 위에 보여 준다', async () => {
  api.addQuestion.mockRejectedValueOnce(new Error('저장 연결 실패'))
  const user = userEvent.setup()
  render(<RecordPage health={null} />)
  expect(disclosure().open).toBe(false)
  const draft = `  ${newQuestion.text}\n한 가지 더 묻고 싶어요.  `
  await user.type(input(), draft)
  await user.click(screen.getByRole('button', { name: '질문 저장', exact: true }))
  expect(await screen.findByText('저장 연결 실패')).toBeTruthy()
  await closeFeedback(user, true)
  expect(input().value).toBe(draft)
  expect(disclosure().open).toBe(false)
  await openPreview(user)
  expect(contents()).toEqual([original[3].text, original[2].text, original[1].text])
  expect(api.questions).toHaveBeenCalledTimes(1)
  await user.click(screen.getByText('최근 질문', { exact: true }))
  expect(disclosure().open).toBe(false)
  const saved = { ...newQuestion, text: draft.trim() }
  api.addQuestion.mockResolvedValueOnce(saved)
  api.questions.mockResolvedValue([...original, saved])
  await user.click(screen.getByRole('button', { name: '질문 저장', exact: true }))
  await closeFeedback(user)
  expect(api.addQuestion.mock.calls).toEqual([[{ text: draft.trim() }], [{ text: draft.trim() }]])
  expect(input().value).toBe('')
  expect(disclosure().open).toBe(true)
  expect(contents()).toEqual([saved.text, original[3].text, original[2].text])
})

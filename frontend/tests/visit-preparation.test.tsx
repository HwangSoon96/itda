import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { SchedulePage } from '../src/features/schedule/SchedulePage'
import { buildTalkingPoints, questionInPeriod } from '../src/shared/lib/visitPreparation'
import type { MemoResult, Question, Summary, Visit } from '../src/api/types'
import { localToday } from '../src/shared/lib/date'

const api = vi.hoisted(() => ({
  summary: vi.fn(),
  memos: vi.fn(),
  visits: vi.fn(),
  medications: vi.fn(),
  questions: vi.fn(),
  addQuestion: vi.fn(),
  deleteQuestion: vi.fn(),
  addVisit: vi.fn(),
  updateVisit: vi.fn(),
  deleteVisit: vi.fn(),
  addMedication: vi.fn(),
  deleteMedication: vi.fn(),
}))
vi.mock('../src/api', () => ({ api }))
const period = { start: '2026-08-20', end: '2026-09-26' }
let saved: Question[]
function changeHash(hash: string) {
  window.history.replaceState(null, '', hash)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}
function selectedList() {
  return screen.getByRole('list', { name: '요약지에 담길 질문 목록' })
}
function otherList() {
  return screen.getByRole('list', { name: '다른 기간의 질문 목록' })
}
async function finishQuestionSave(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    within(await screen.findByRole('dialog', { name: '저장했어요' })).getByRole('button', {
      name: '확인',
    }),
  )
}
async function ready() {
  await waitFor(() => expect(screen.queryByText('저장한 기록을 모으고 있어요…')).toBeNull())
}
async function openQuestions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: '질문 메모' }))
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 27, 12))
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
  saved = []
  changeHash('#schedule?as_of=2026-09-26&period_start=2026-08-20')
  api.visits.mockResolvedValue([])
  api.medications.mockResolvedValue([])
  api.questions.mockImplementation(async () => [...saved])
  api.summary.mockImplementation(async (asOf, start) => ({
    period: { start: start || '2026-08-20', end: asOf || localToday() },
  }))
  api.addQuestion.mockImplementation(
    async (body: { text: string; period_start?: string; period_end?: string }) => {
      const question = { ...body, id: saved.length + 1, created_at: localToday() }
      saved.push(question)
      return question
    },
  )
  api.deleteQuestion.mockImplementation(async (id: number) => {
    saved = saved.filter((question) => question.id !== id)
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
})

it('질문 포함 여부는 기존 기간 연결 필드가 있어도 실제 작성일의 양 끝 날짜를 포함한다', () => {
  const question = {
    id: 1,
    text: '질문',
    created_at: '2026-09-27',
    period_start: period.start,
    period_end: period.end,
  }
  expect(questionInPeriod(question, period)).toBe(false)
  expect(questionInPeriod(question, { ...period, end: '2026-09-27' })).toBe(true)
  for (const day of [period.start, period.end])
    expect(questionInPeriod({ ...question, created_at: `${day}T23:59:00` }, period)).toBe(true)
  for (const day of ['2026-08-19', '2026-09-27'])
    expect(questionInPeriod({ id: 2, text: '이전', created_at: day }, period)).toBe(false)
})

it('진료에 전할 관찰은 저장 시각과 관계없이 메모에서 선택한 날짜를 사용한다', () => {
  const summary: Summary = {
    patient_alias: '보호 대상',
    period,
    baseline: null,
    coverage: { total_days: 38, recorded_days: 2 },
    rows: ['야간 각성', '낙상'].map((type) => ({
      type: type as '야간 각성' | '낙상',
      baseline_rate: null,
      current_rate: 1,
      weekly_count: 7,
      mark: null,
      evidence_dates: ['2026-09-21'],
      memo_ids: [1],
      occurrence_days: 1,
      recorded_days: 2,
    })),
    sentences: [],
    medications: [],
    falls: ['2026-09-21'],
    questions: [],
    disclaimer: '',
  }
  const selected: MemoResult & { created_at: string } = {
    memo_id: 1,
    record_date: '2026-09-21',
    created_at: '2026-09-27T10:00:00',
    status: '확인 완료',
    text: '밤에 두 번 깨셨다. 오후에 넘어지셨다.',
    emergency: { matched: false, message: null },
    events: [
      {
        type: '야간 각성',
        status: '있었음',
        time_expr: '밤',
        count: 2,
        evidence: '밤에 두 번 깨셨다.',
      },
      {
        type: '낙상',
        status: '있었음',
        time_expr: '오후',
        count: 1,
        evidence: '오후에 넘어지셨다.',
      },
    ],
  }
  const older = {
    ...selected,
    memo_id: 99,
    record_date: '2026-09-20',
    created_at: '2026-09-28T10:00:00',
  }
  const outside = {
    ...selected,
    memo_id: 100,
    record_date: '2026-09-27',
    created_at: '2026-09-21T10:00:00',
  }
  const pending = {
    ...selected,
    memo_id: 101,
    record_date: '2026-09-26',
    status: '확인 대기' as const,
  }

  const points = buildTalkingPoints(summary, [outside, older, selected, pending])

  expect(points.map(({ type, date, memoId }) => ({ type, date, memoId }))).toEqual([
    { type: '낙상', date: '2026-09-21', memoId: 1 },
    { type: '야간 각성', date: '2026-09-21', memoId: 1 },
  ])
  expect(points.map((point) => point.quote)).toEqual(['오후에 넘어지셨다.', '밤에 두 번 깨셨다.'])
})
it('모바일은 진료일·약 변경·질문 메모 세 탭에서 필요한 양식만 보이고 입력은 보존한다', async () => {
  const user = userEvent.setup()
  render(<SchedulePage />)
  await ready()
  expect(
    within(screen.getByRole('tablist', { name: '일정 항목' }))
      .getAllByRole('tab')
      .map((tab) => tab.textContent),
  ).toEqual(['진료일', '약 변경', '질문 메모'])
  expect(screen.getByRole('tabpanel', { name: '진료일' })).toBeTruthy()
  expect(screen.queryByRole('textbox', { name: '약 이름' })).toBeNull()
  await user.click(screen.getByRole('tab', { name: '약 변경' }))
  expect(screen.getByRole('heading', { name: '약 변경 기록' })).toBeTruthy()
  await user.type(screen.getByRole('textbox', { name: '약 이름' }), '작성 중인 약')
  await openQuestions(user)
  expect(screen.getByRole('tabpanel', { name: '질문 메모' })).toBeTruthy()
  expect(screen.getByLabelText('다음 진료 때 묻고 싶은 것', { selector: 'textarea' })).toBeTruthy()
  expect(api.memos).not.toHaveBeenCalled()
  expect(api.addQuestion).not.toHaveBeenCalled()
  await user.click(screen.getByRole('tab', { name: '약 변경' }))
  expect((screen.getByRole('textbox', { name: '약 이름' }) as HTMLInputElement).value).toBe(
    '작성 중인 약',
  )
  const drugTab = screen.getByRole('tab', { name: '약 변경' })
  drugTab.focus()
  await user.keyboard('{ArrowRight}')
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: '질문 메모' }))
  expect(screen.getByRole('tab', { name: '질문 메모' }).getAttribute('aria-selected')).toBe('true')
  expect(location.hash).toBe('#schedule?as_of=2026-09-26&period_start=2026-08-20')
})
it('과거 as_of에서 저장한 오늘 질문은 확인 후 다른 기간에 펼쳐 보이고 과거 PDF에는 포함되지 않는다', async () => {
  // The development API is memory-only; this exercises its existing report filter without a live DB.
  const { mockApi } = await import('../src/api/mock/mockApi')
  api.questions.mockImplementation(() => mockApi.questions())
  api.addQuestion.mockImplementation((body) => mockApi.addQuestion(body))
  const user = userEvent.setup()
  render(<SchedulePage />)
  await ready()
  await openQuestions(user)
  expect(screen.queryByRole('link', { name: '기간 변경' })).toBeNull()
  const original = '욕실에서 넘어진 기록을 함께 봐 주세요.\n집에서 남길 내용을 알고 싶어요.'
  const input = screen.getByLabelText('다음 진료 때 묻고 싶은 것', {
    selector: 'textarea',
  }) as HTMLTextAreaElement
  await user.type(input, original)
  await user.click(screen.getByRole('button', { name: '질문 저장' }))
  await waitFor(() => expect(api.addQuestion).toHaveBeenCalledExactlyOnceWith({ text: original }))
  await ready()
  expect(within(selectedList()).queryByText(original, { normalizer: (value) => value })).toBeNull()
  const outside = screen.getByText(/다른 기간의 질문 \d+개 보기/).closest('details')!
  expect(outside.open).toBe(false)
  await finishQuestionSave(user)
  await waitFor(() => expect(outside.open).toBe(true))
  const paragraph = within(otherList()).getByText(original, { normalizer: (value) => value })
  expect(within(otherList()).getAllByRole('listitem')[0].textContent).toContain(original)
  await waitFor(() => expect(document.activeElement).toBe(paragraph.closest('li')))
  expect(screen.getByRole('tab', { name: '질문 메모' }).getAttribute('aria-selected')).toBe('true')
  expect(input.value).toBe('')
  expect(
    (await mockApi.questions()).find((question) => question.text === original)?.created_at,
  ).toBe('2026-09-27')
  expect((await mockApi.summary(period.end, period.start)).questions).not.toContain(original)
  expect((await mockApi.summary('2026-09-27', period.start)).questions).toContain(original)
  expect(api.summary).toHaveBeenCalledWith(expect.any(String), expect.any(String), false)
})
it('저장 중 중복 요청을 막고 실패하면 작성한 질문을 보존해 같은 내용으로 재시도한다', async () => {
  const user = userEvent.setup()
  let reject!: (reason: Error) => void
  api.addQuestion.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail
      }),
  )
  render(<SchedulePage />)
  await ready()
  await openQuestions(user)
  await user.type(
    screen.getByLabelText('다음 진료 때 묻고 싶은 것', { selector: 'textarea' }),
    '밤 기록을 함께 보고 싶어요.',
  )
  const save = screen.getByRole('button', { name: '질문 저장' })
  fireEvent.click(save)
  fireEvent.click(save)
  expect(api.addQuestion).toHaveBeenCalledTimes(1)
  expect((save as HTMLButtonElement).disabled).toBe(true)
  await act(async () => reject(new Error('저장 연결이 끊겼어요.')))
  expect((await screen.findByRole('alertdialog')).textContent).toContain('저장 연결')
  expect(
    (
      screen.getByLabelText('다음 진료 때 묻고 싶은 것', {
        selector: 'textarea',
      }) as HTMLTextAreaElement
    ).value,
  ).toBe('밤 기록을 함께 보고 싶어요.')
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: '다시 저장하기' }),
  )
  await waitFor(() => expect(api.addQuestion).toHaveBeenCalledTimes(2))
  expect(api.addQuestion.mock.calls[0]).toEqual(api.addQuestion.mock.calls[1])
})
it('일부 조회가 실패하면 질문 저장을 중지하고 불러온 진료 날짜는 확인할 수 있다', async () => {
  const user = userEvent.setup()
  api.visits.mockResolvedValue([
    { id: 1, visit_date: '2026-08-20', status: '완료' } satisfies Visit,
  ])
  api.questions.mockRejectedValue(new Error('질문 조회 실패'))
  render(<SchedulePage />)
  await ready()
  expect(screen.getByRole('alertdialog').textContent).toContain('질문 조회 실패')
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '확인' }))
  expect(screen.getByText('2026년 8월 20일')).toBeTruthy()
  expect(
    within(screen.getByRole('region', { name: '최근 받은 진료' })).getByText('2026년 8월 20일'),
  ).toBeTruthy()
  await openQuestions(user)
  expect((screen.getByRole('button', { name: '질문 저장' }) as HTMLButtonElement).disabled).toBe(
    true,
  )
  expect(api.addQuestion).not.toHaveBeenCalled()
})
it('기록 화면 질문 목록 링크로 오면 선택 기간을 유지하고 질문 탭에 포커스한다', async () => {
  changeHash('#schedule?as_of=2026-09-26&period_start=2026-08-20&tab=questions')
  render(<SchedulePage />)
  await ready()
  expect(screen.getByRole('tab', { name: '질문 메모' }).getAttribute('aria-selected')).toBe('true')
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: '질문 메모' }))
  expect(screen.getByLabelText('다음 진료 때 묻고 싶은 것', { selector: 'textarea' })).toBeTruthy()
  expect(api.summary).toHaveBeenCalledWith(expect.any(String), expect.any(String), false)
})
it('탭을 이동해도 미저장 질문을 보존한다', async () => {
  const user = userEvent.setup()
  render(<SchedulePage />)
  await ready()
  await openQuestions(user)
  await user.type(screen.getByLabelText('다음 진료 때 묻고 싶은 것'), '직접 물어볼 내용입니다.')
  await user.click(screen.getByRole('tab', { name: '진료일' }))
  await openQuestions(user)
  expect((screen.getByLabelText('다음 진료 때 묻고 싶은 것') as HTMLTextAreaElement).value).toBe(
    '직접 물어볼 내용입니다.',
  )
  expect(api.addQuestion).not.toHaveBeenCalled()
})
it('조회 기간을 바꾸어도 하나의 미저장 질문을 유지하고 성공한 뒤에만 비운다', async () => {
  const user = userEvent.setup()
  const dirty = vi.fn()
  window.addEventListener('itda-final-dirty', dirty)
  try {
    render(<SchedulePage />)
    await ready()
    await openQuestions(user)
    const input = screen.getByLabelText('다음 진료 때 묻고 싶은 것') as HTMLTextAreaElement
    await user.type(input, '8월부터의 기록을 함께 봐 주세요.')
    await act(async () => changeHash('#schedule?as_of=2026-09-20&period_start=2026-09-01'))
    expect(input.value).toBe('8월부터의 기록을 함께 봐 주세요.')
    expect(dirty.mock.lastCall?.[0]).toMatchObject({ detail: { key: 'schedule', dirty: true } })
    await act(async () => changeHash('#schedule?as_of=2026-09-26&period_start=2026-08-20'))
    expect(input.value).toBe('8월부터의 기록을 함께 봐 주세요.')
    await user.click(screen.getByRole('button', { name: '질문 저장' }))
    await ready()
    await act(async () => changeHash('#schedule?as_of=2026-09-20&period_start=2026-09-01'))
    expect(input.value).toBe('')
    expect(dirty.mock.lastCall?.[0]).toMatchObject({ detail: { key: 'schedule', dirty: false } })
    expect(api.summary).toHaveBeenCalledWith(expect.any(String), expect.any(String), false)
  } finally {
    window.removeEventListener('itda-final-dirty', dirty)
  }
})
it('오늘 작성한 질문은 공백 차이로 중복 저장하지 않으며 삭제 확인 전까지 보존한다', async () => {
  changeHash('#schedule?as_of=2026-09-27&period_start=2026-08-20')
  const user = userEvent.setup()
  saved = [
    {
      id: 21,
      text: '밤 기록을 함께 봐 주세요.',
      created_at: localToday(),
      period_start: period.start,
      period_end: period.end,
    },
  ]
  render(<SchedulePage />)
  await ready()
  await openQuestions(user)
  await user.type(
    screen.getByLabelText('다음 진료 때 묻고 싶은 것', { selector: 'textarea' }),
    '  밤 기록을\n함께 봐 주세요.  ',
  )
  await user.click(screen.getByRole('button', { name: '질문 저장' }))
  expect((await screen.findByRole('alertdialog')).textContent).toContain('오늘 저장한 같은 질문')
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '확인' }))
  expect(api.addQuestion).not.toHaveBeenCalled()
  await user.click(
    within(selectedList()).getByRole('button', {
      name: '2026년 9월 27일 밤 기록을 함께 봐 주세요. 관리',
    }),
  )
  let manager = within(screen.getByRole('dialog', { name: '질문 관리' }))
  expect(manager.getByText('밤 기록을 함께 봐 주세요.')).toBeTruthy()
  expect(manager.getByText('2026년 9월 27일')).toBeTruthy()
  expect(manager.queryByRole('textbox')).toBeNull()
  await user.click(manager.getByRole('button', { name: '질문 삭제' }))
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '취소' }))
  expect(api.deleteQuestion).not.toHaveBeenCalled()
  expect(saved).toHaveLength(1)
  manager = within(screen.getByRole('dialog', { name: '질문 관리' }))
  await user.click(manager.getByRole('button', { name: '질문 삭제' }))
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: '삭제하기' }),
  )
  await waitFor(() => expect(api.deleteQuestion).toHaveBeenCalledExactlyOnceWith(21))
  await ready()
  expect(screen.queryByRole('list', { name: '요약지에 담길 질문 목록' })).toBeNull()
  expect(screen.getByText('아직 저장한 질문이 없어요.')).toBeTruthy()
  expect(screen.queryByRole('dialog', { name: '질문 관리' })).toBeNull()
  expect(
    (
      screen.getByLabelText('다음 진료 때 묻고 싶은 것', {
        selector: 'textarea',
      }) as HTMLTextAreaElement
    ).value,
  ).toBe('  밤 기록을\n함께 봐 주세요.  ')
})
it('포함 질문과 다른 기간 질문을 나누고 각 목록은 작성일·추가 순서의 내림차순으로 보여준다', async () => {
  const user = userEvent.setup()
  saved = [
    { id: 10, text: '예전 질문', created_at: '2026-07-30' },
    { id: 11, text: '이번 질문', created_at: '2026-09-01' },
    { id: 13, text: '오늘 나중 질문', created_at: '2026-09-27' },
    { id: 12, text: '오늘 먼저 질문', created_at: '2026-09-27' },
    { id: 14, text: '이번 나중 질문', created_at: '2026-09-01' },
  ]
  render(<SchedulePage />)
  await ready()
  await openQuestions(user)
  expect(
    within(selectedList())
      .getAllByRole('listitem')
      .map((item) => item.querySelector('.mvp-question-row-text')?.textContent),
  ).toEqual(['이번 나중 질문', '이번 질문'])
  const outside = screen.getByText('다른 기간의 질문 3개 보기').closest('details')!
  expect(outside.open).toBe(false)
  await user.click(within(outside).getByText('다른 기간의 질문 3개 보기'))
  expect(
    within(otherList())
      .getAllByRole('listitem')
      .map((item) => item.querySelector('.mvp-question-row-text')?.textContent),
  ).toEqual(['오늘 나중 질문', '오늘 먼저 질문', '예전 질문'])
  expect(api.addQuestion).not.toHaveBeenCalled()
  expect(api.deleteQuestion).not.toHaveBeenCalled()
})
it('진료 날짜 조회 실패와 관계없이 질문은 저장하고 AI 없이 포함 기간을 조회한다', async () => {
  api.visits.mockRejectedValue(new Error('진료일 조회 실패'))
  const user = userEvent.setup()
  render(<SchedulePage />)
  await ready()
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '확인' }))
  await openQuestions(user)
  await user.type(screen.getByLabelText('다음 진료 때 묻고 싶은 것'), '질문만 저장합니다.')
  await user.click(screen.getByRole('button', { name: '질문 저장' }))
  await waitFor(() =>
    expect(api.addQuestion).toHaveBeenCalledExactlyOnceWith({ text: '질문만 저장합니다.' }),
  )
  expect(api.summary).toHaveBeenCalledWith(expect.any(String), expect.any(String), false)
})
it('기간과 관계없이 질문의 줄바꿈과 빈 줄을 그대로 표시한다', async () => {
  const original = '첫 번째 질문입니다.\n\n  두 번째 질문입니다.'
  saved = [{ id: 10, text: original, created_at: '2026-07-30' }]
  const styles = document.createElement('style')
  styles.textContent =
    readFileSync('src/features/schedule/schedule-clarity.css', 'utf8') +
    readFileSync('src/features/schedule/schedule.css', 'utf8')
  document.head.append(styles)
  try {
    const user = userEvent.setup()
    render(<SchedulePage />)
    await ready()
    await openQuestions(user)
    await user.click(screen.getByText('다른 기간의 질문 1개 보기'))
    const body = within(otherList()).getByText(original, { normalizer: (value) => value })
    expect(body.textContent).toBe(original)
    expect(getComputedStyle(body).whiteSpace).toBe('pre-wrap')
    expect(getComputedStyle(body).overflowWrap).toBe('anywhere')
    await user.click(within(otherList()).getByRole('button'))
    const manager = within(screen.getByRole('dialog', { name: '질문 관리' }))
    expect(manager.getByText(original, { normalizer: (value) => value })).toBeTruthy()
    expect(manager.getByText('2026년 7월 30일')).toBeTruthy()
    expect(manager.queryByRole('textbox')).toBeNull()
  } finally {
    styles.remove()
  }
})

it('PC에서는 진료일·약 변경·질문을 동시에 표시하고 어느 입력도 사라지지 않는다', async () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  const user = userEvent.setup()
  render(<SchedulePage />)
  await ready()
  expect(screen.getByRole('region', { name: '진료일' })).toBeTruthy()
  expect(screen.getByRole('region', { name: '약 변경 기록' })).toBeTruthy()
  expect(screen.getByRole('region', { name: '의사에게 물어볼 것' })).toBeTruthy()
  await user.type(screen.getByLabelText('약 이름'), '처방약 A')
  await user.type(screen.getByLabelText('다음 진료 때 묻고 싶은 것'), '궁금한 점')
  expect((screen.getByLabelText('약 이름') as HTMLInputElement).value).toBe('처방약 A')
  expect((screen.getByLabelText('다음 진료 때 묻고 싶은 것') as HTMLTextAreaElement).value).toBe(
    '궁금한 점',
  )
})

it('요약 API가 정한 실제 기간으로 포함·이전·이후 질문을 구분한다', async () => {
  saved = [
    { id: 1, text: '기간 시작 전', created_at: '2026-08-31' },
    { id: 2, text: '시작일 질문', created_at: '2026-09-01' },
    { id: 3, text: '마지막 날 질문', created_at: '2026-09-26' },
    { id: 4, text: '아직 포함 안 되는 질문', created_at: '2026-09-27' },
  ]
  api.summary.mockResolvedValue({ period: { start: '2026-09-01', end: '2026-09-26' } })
  const user = userEvent.setup()
  render(<SchedulePage />)
  await ready()
  await openQuestions(user)
  expect(
    within(selectedList())
      .getAllByRole('listitem')
      .map((row) => row.querySelector('.mvp-question-row-text')?.textContent),
  ).toEqual(['마지막 날 질문', '시작일 질문'])
  expect(within(selectedList()).queryByText('기간 시작 전')).toBeNull()
  expect(within(selectedList()).queryByText('아직 포함 안 되는 질문')).toBeNull()
  await user.click(screen.getByText('다른 기간의 질문 2개 보기'))
  expect(
    within(otherList())
      .getAllByRole('listitem')
      .map((row) => row.querySelector('.mvp-question-row-text')?.textContent),
  ).toEqual(['아직 포함 안 되는 질문', '기간 시작 전'])
  expect(api.summary).toHaveBeenCalledExactlyOnceWith('2026-09-26', '2026-08-20', false)
})

it('요약 기간 조회 실패 시 저장한 질문으로 표시하고 저장·재조회 복구 후 실제 기간으로 나눈다', async () => {
  saved = [{ id: 1, text: '저장한 질문', created_at: '2026-09-20' }]
  api.summary.mockRejectedValue(new Error('기간 응답 없음'))
  const user = userEvent.setup()
  render(<SchedulePage />)
  await ready()
  await openQuestions(user)
  const fallback = screen.getByRole('region', { name: '저장한 질문' })
  expect(within(fallback).getByText('요약지 포함 여부를 확인하지 못했어요.')).toBeTruthy()
  expect(within(fallback).getByRole('list', { name: '저장한 질문 목록' })).toBeTruthy()
  expect(screen.queryByRole('region', { name: '요약지에 담길 질문' })).toBeNull()
  expect(screen.queryByRole('list', { name: '요약지에 담길 질문 목록' })).toBeNull()
  await user.type(screen.getByLabelText('다음 진료 때 묻고 싶은 것'), '새 질문')
  await user.click(screen.getByRole('button', { name: '질문 저장' }))
  await waitFor(() => expect(api.addQuestion).toHaveBeenCalledExactlyOnceWith({ text: '새 질문' }))
  await ready()
  await finishQuestionSave(user)
  expect(
    within(screen.getByRole('list', { name: '저장한 질문 목록' })).getByText('새 질문'),
  ).toBeTruthy()
  api.summary.mockResolvedValue({ period: { start: '2026-09-01', end: '2026-09-26' } })
  await user.click(screen.getByRole('button', { name: '다시 확인하기' }))
  await ready()
  expect(screen.queryByRole('region', { name: '저장한 질문' })).toBeNull()
  expect(screen.queryByText('요약지 포함 여부를 확인하지 못했어요.')).toBeNull()
  expect(within(selectedList()).getByText('저장한 질문')).toBeTruthy()
  expect(within(selectedList()).queryByText('새 질문')).toBeNull()
  const outside = screen.getByText('다른 기간의 질문 1개 보기').closest('details')!
  if (!outside.open) await user.click(within(outside).getByText('다른 기간의 질문 1개 보기'))
  expect(within(otherList()).getByText('새 질문')).toBeTruthy()
  expect(api.summary.mock.calls.every((call) => call[2] === false)).toBe(true)
})

it('요약 기간을 다시 조회하는 동안 이전 포함 결과를 확정된 것처럼 보이지 않는다', async () => {
  saved = [{ id: 1, text: '다시 분류할 질문', created_at: '2026-09-20' }]
  const user = userEvent.setup()
  render(<SchedulePage />)
  await ready()
  await openQuestions(user)
  expect(within(selectedList()).getByText('다시 분류할 질문')).toBeTruthy()
  let resolve!: (value: { period: { start: string; end: string } }) => void
  api.summary.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  await act(async () => changeHash('#schedule?as_of=2026-09-27&period_start=2026-09-21'))
  expect(screen.getByRole('region', { name: '저장한 질문' })).toBeTruthy()
  expect(screen.getByText('요약 기간 확인 중…')).toBeTruthy()
  expect(screen.queryByRole('list', { name: '요약지에 담길 질문 목록' })).toBeNull()
  expect(
    within(screen.getByRole('list', { name: '저장한 질문 목록' })).getByText('다시 분류할 질문'),
  ).toBeTruthy()
  await act(async () => resolve({ period: { start: '2026-09-21', end: '2026-09-27' } }))
  await ready()
  expect(screen.queryByText('요약 기간 확인 중…')).toBeNull()
  expect(screen.queryByRole('list', { name: '요약지에 담길 질문 목록' })).toBeNull()
  expect(screen.getByText('이 기간에 저장한 질문이 없어요.')).toBeTruthy()
  await user.click(screen.getByText('다른 기간의 질문 1개 보기'))
  expect(within(otherList()).getByText('다시 분류할 질문')).toBeTruthy()
})

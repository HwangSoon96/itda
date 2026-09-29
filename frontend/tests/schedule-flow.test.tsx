import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SchedulePage } from '../src/features/schedule/SchedulePage'
import type { Medication, Question, Visit } from '../src/api/types'

const api = vi.hoisted(() => ({
  summary: vi.fn(),
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

let visits: Visit[]
let medications: Medication[]
let questions: Question[]
const ready = async () => {
  await waitFor(() => expect(screen.queryByText('저장한 기록을 모으고 있어요…')).toBeNull())
}
const input = (name: string) => screen.getByLabelText(name) as HTMLInputElement
const finishFeedback = async (
  user: ReturnType<typeof userEvent.setup>,
  role: 'dialog' | 'alertdialog' = 'dialog',
) => {
  await user.click(within(screen.getByRole(role)).getByRole('button', { name: '확인' }))
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 28, 12))
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  window.history.replaceState(null, '', '#schedule')
  visits = [
    { id: 1, visit_date: '2026-09-01', status: '완료' },
    { id: 2, visit_date: '2026-09-20', status: '예정' },
  ]
  medications = [{ id: 3, name: '처방약 A', change_type: '증량', change_date: '2026-09-21' }]
  questions = [{ id: 4, text: '기억해야 할 질문', created_at: '2026-09-22' }]
  api.visits.mockImplementation(async () => [...visits])
  api.medications.mockImplementation(async () => [...medications])
  api.questions.mockImplementation(async () => [...questions])
  api.summary.mockResolvedValue({ period: { start: '2026-09-01', end: '2026-09-28' } })
  api.addVisit.mockImplementation(async (body: Omit<Visit, 'id'>) => {
    const item = { ...body, id: 11 }
    visits.push(item)
    return item
  })
  api.addMedication.mockImplementation(async (body: Omit<Medication, 'id'>) => {
    const item = { ...body, id: 12 }
    medications.push(item)
    return item
  })
  api.addQuestion.mockImplementation(async (body: { text: string }) => {
    const item = { ...body, id: 13, created_at: '2026-09-28' }
    questions.push(item)
    return item
  })
  api.updateVisit.mockImplementation(async (id: number, body: Partial<Visit>) => {
    const item = { ...visits.find((visit) => visit.id === id)!, ...body }
    visits = visits.map((visit) => (visit.id === id ? item : visit))
    return item
  })
  api.deleteVisit.mockImplementation(async (id: number) => {
    visits = visits.filter((item) => item.id !== id)
  })
  api.deleteMedication.mockImplementation(async (id: number) => {
    medications = medications.filter((item) => item.id !== id)
  })
  api.deleteQuestion.mockImplementation(async (id: number) => {
    questions = questions.filter((item) => item.id !== id)
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it.each([
  ['2026년 9월 1일 진료일 관리', '진료일 관리', ['2026년 9월 1일']],
  ['2026년 9월 21일 처방약 A 용량 늘림 관리', '약 변경 기록 관리', ['처방약 A', '2026년 9월 21일']],
  ['2026년 9월 22일 기억해야 할 질문 관리', '질문 관리', ['기억해야 할 질문', '2026년 9월 22일']],
] as const)(
  '%s 항목의 내용·날짜와 Enter·Space로 같은 관리 팝업을 연다',
  async (label, title, texts) => {
    const user = userEvent.setup()
    render(<SchedulePage />)
    await ready()
    const item = screen.getByRole('button', { name: label })
    expect(item.tagName).toBe('BUTTON')
    expect(within(item).queryByRole('button')).toBeNull()
    expect(within(item).queryByText('관리', { exact: true })).toBeNull()

    const closeManager = async () => {
      const manager = await screen.findByRole('dialog', { name: title })
      fireEvent(manager, new Event('cancel', { cancelable: true }))
      expect(screen.queryByRole('dialog', { name: title })).toBeNull()
      await waitFor(() => expect(document.activeElement).toBe(item))
    }
    for (const text of texts) {
      await user.click(within(item).getByText(text, { exact: true }))
      await closeManager()
    }
    for (const key of ['{Enter}', ' ']) {
      item.focus()
      await user.keyboard(key)
      await closeManager()
    }
    expect(api.updateVisit).not.toHaveBeenCalled()
    expect(api.deleteVisit).not.toHaveBeenCalled()
    expect(api.deleteMedication).not.toHaveBeenCalled()
    expect(api.deleteQuestion).not.toHaveBeenCalled()
  },
)

it.each([1440, 360])(
  '%dpx 화면에서 다음 예약을 선택하고 예약일을 등록하면 예정 상태로 저장한다',
  async (width) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    const user = userEvent.setup()
    render(<SchedulePage />)
    await ready()
    const form = screen.getByRole('form', { name: '진료 날짜 등록' })
    const mode = within(form).getByRole('group', { name: '등록할 진료' })
    expect(
      (within(mode).getByRole('radio', { name: '받은 진료' }) as HTMLInputElement).checked,
    ).toBe(true)
    await user.click(within(mode).getByRole('radio', { name: '다음 예약' }))
    const date = within(form).getByLabelText('다음 예약일') as HTMLInputElement
    const register = within(form).getByRole('button', {
      name: '다음 예약 등록',
    }) as HTMLButtonElement
    expect(date.type).toBe('date')
    expect(date.value).toBe('2026-09-28')
    expect(register.disabled).toBe(false)
    fireEvent.change(date, { target: { value: '2026-10-05' } })
    expect(register.disabled).toBe(false)
    await user.click(register)
    await waitFor(() =>
      expect(api.addVisit).toHaveBeenCalledExactlyOnceWith({
        visit_date: '2026-10-05',
        status: '예정',
      }),
    )
    expect(screen.getByText('다음 예약을 등록했어요.')).toBeTruthy()
    await finishFeedback(user)
    expect(date.value).toBe('2026-09-28')
    expect(register.disabled).toBe(false)
    expect(screen.getByRole('button', { name: '2026년 10월 5일 진료일 관리' })).toBeTruthy()
  },
)

it.each([
  ['받은 진료', '진료받은 날', '완료', '2026-09-29', 'max', '다음 예약', '다음 예약일'],
  ['다음 예약', '다음 예약일', '예정', '2026-09-27', 'min', '받은 진료', '진료받은 날'],
] as const)(
  '%s는 범위를 벗어난 날짜를 저장하지 않고 오늘은 선택한 상태로 등록한다',
  async (mode, field, status, invalidDate, boundary, otherMode, otherField) => {
    const user = userEvent.setup()
    render(<SchedulePage />)
    await ready()
    const form = screen.getByRole('form', { name: '진료 날짜 등록' })
    await user.click(within(form).getByRole('radio', { name: mode }))
    const date = within(form).getByLabelText(field) as HTMLInputElement
    expect(date[boundary]).toBe('2026-09-28')
    fireEvent.change(date, { target: { value: invalidDate } })
    expect(date.checkValidity()).toBe(false)
    expect((within(form).getByRole('radio', { name: mode }) as HTMLInputElement).checked).toBe(true)
    await user.click(within(form).getByRole('button', { name: `${mode} 등록` }))
    expect(api.addVisit).not.toHaveBeenCalled()
    fireEvent.submit(form)
    await screen.findByRole('alertdialog', { name: '입력을 확인해 주세요' })
    expect(api.addVisit).not.toHaveBeenCalled()
    await finishFeedback(user, 'alertdialog')

    fireEvent.change(date, { target: { value: '2026-09-28' } })
    expect(date.checkValidity()).toBe(true)
    await user.click(within(form).getByRole('radio', { name: otherMode }))
    expect((within(form).getByLabelText(otherField) as HTMLInputElement).value).toBe('2026-09-28')
    await user.click(within(form).getByRole('radio', { name: mode }))
    expect((within(form).getByLabelText(field) as HTMLInputElement).value).toBe('2026-09-28')
    await user.click(within(form).getByRole('button', { name: `${mode} 등록` }))
    expect(api.addVisit).toHaveBeenCalledExactlyOnceWith({ visit_date: '2026-09-28', status })
    expect(
      await screen.findByText(
        status === '완료' ? '받은 진료를 등록했어요.' : '다음 예약을 등록했어요.',
      ),
    ).toBeTruthy()
    await finishFeedback(user)
    expect((within(form).getByLabelText(field) as HTMLInputElement).value).toBe('2026-09-28')
  },
)

it('받은 진료와 다음 예약을 바꾸면 새 선택 범위를 벗어난 날짜만 비운다', async () => {
  const user = userEvent.setup()
  render(<SchedulePage />)
  await ready()
  fireEvent.change(input('진료받은 날'), { target: { value: '2026-09-27' } })
  await user.click(screen.getByRole('radio', { name: '다음 예약' }))
  expect(input('다음 예약일').value).toBe('')
  expect(
    (screen.getByRole('button', { name: '다음 예약 등록' }) as HTMLButtonElement).disabled,
  ).toBe(true)
  fireEvent.change(input('다음 예약일'), { target: { value: '2026-09-29' } })
  await user.click(screen.getByRole('radio', { name: '받은 진료' }))
  expect(input('진료받은 날').value).toBe('')
  expect(
    (screen.getByRole('button', { name: '받은 진료 등록' }) as HTMLButtonElement).disabled,
  ).toBe(true)
  expect(api.addVisit).not.toHaveBeenCalled()
})

it('약 변경 유형은 직접 골라야 하며 선택하지 않거나 미래 날짜이면 저장하지 않는다', async () => {
  const user = userEvent.setup()
  render(<SchedulePage />)
  await ready()
  const form = screen.getByRole('form', { name: '약 변경 기록' })
  const choices = within(within(form).getByRole('group', { name: '어떻게 바뀌었나요?' }))
  expect(choices.getAllByRole('radio').map((radio) => (radio as HTMLInputElement).checked)).toEqual(
    [false, false, false, false],
  )
  const save = within(form).getByRole('button', { name: '변경 내용 저장' }) as HTMLButtonElement
  expect(save.disabled).toBe(true)
  await user.type(within(form).getByRole('textbox', { name: '약 이름' }), '처방약 C')
  const date = within(form).getByLabelText('바뀐 날') as HTMLInputElement
  expect(date.max).toBe('2026-09-28')
  fireEvent.change(date, { target: { value: '2026-09-28' } })
  expect(save.disabled).toBe(true)
  fireEvent.submit(form)
  expect(await screen.findByText('약이 어떻게 바뀌었는지 선택해 주세요.')).toBeTruthy()
  expect(api.addMedication).not.toHaveBeenCalled()
  await finishFeedback(user, 'alertdialog')
  await user.click(choices.getByRole('radio', { name: '복용 시작' }))
  expect(save.disabled).toBe(false)
  fireEvent.change(date, { target: { value: '2026-09-29' } })
  expect(date.validity.rangeOverflow).toBe(true)
  await user.click(save)
  expect(api.addMedication).not.toHaveBeenCalled()
  fireEvent.submit(form)
  expect(
    await screen.findByText('약을 바꾼 날짜는 오늘 또는 지난 날짜로 골라 주세요.'),
  ).toBeTruthy()
  expect(api.addMedication).not.toHaveBeenCalled()
  expect(date.value).toBe('2026-09-29')
  expect((choices.getByRole('radio', { name: '복용 시작' }) as HTMLInputElement).checked).toBe(true)
})

it.each([
  ['복용 시작', '시작'],
  ['복용 중단', '중단'],
] as const)('%s를 선택하면 화면 표현과 관계없이 %s 코드로 저장한다', async (label, code) => {
  const user = userEvent.setup()
  render(<SchedulePage />)
  await ready()
  await user.type(input('약 이름'), '  처방약 C  ')
  await user.click(screen.getByRole('radio', { name: label }))
  fireEvent.change(input('바뀐 날'), { target: { value: '2026-09-26' } })
  await user.click(screen.getByRole('button', { name: '변경 내용 저장' }))
  expect(api.addMedication).toHaveBeenCalledExactlyOnceWith({
    name: '처방약 C',
    change_type: code,
    change_date: '2026-09-26',
  })
  expect(await screen.findByText('약 변경을 저장했어요.')).toBeTruthy()
  await finishFeedback(user)
  expect(
    screen.getByRole('button', { name: `2026년 9월 26일 처방약 C ${label} 관리` }),
  ).toBeTruthy()
  expect(input('약 이름').value).toBe('')
  expect(input('바뀐 날').value).toBe('2026-09-28')
  expect(
    within(screen.getByRole('group', { name: '어떻게 바뀌었나요?' })).queryByRole('radio', {
      checked: true,
    }),
  ).toBeNull()
})

it('약 변경은 날짜와 저장 순서로 최근 세 건만 펼치고 과거에 추가한 기록은 확인 후 찾아준다', async () => {
  medications = [
    { id: 2, name: '처방약 A', change_type: '시작', change_date: '2026-09-20' },
    { id: 5, name: '처방약 B', change_type: '중단', change_date: '2026-09-25' },
    { id: 1, name: '처방약 E', change_type: '시작', change_date: '2026-09-02' },
    { id: 4, name: '처방약 D', change_type: '감량', change_date: '2026-09-10' },
    { id: 3, name: '처방약 C', change_type: '증량', change_date: '2026-09-25' },
  ]
  const user = userEvent.setup()
  render(<SchedulePage />)
  await ready()
  const history = screen.getByRole('region', { name: '최근 변경 기록' })
  const recent = within(within(history).getAllByRole('list')[0])
  expect(recent.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
    '2026년 9월 25일 처방약 B 복용 중단 관리',
    '2026년 9월 25일 처방약 C 용량 늘림 관리',
    '2026년 9월 20일 처방약 A 복용 시작 관리',
  ])
  const older = within(history).getByText('지난 약 변경 2건 보기').closest('details')!
  expect(older.open).toBe(false)
  await user.click(within(older).getByText('지난 약 변경 2건 보기'))
  expect(
    within(older)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label')),
  ).toEqual(['2026년 9월 10일 처방약 D 용량 줄임 관리', '2026년 9월 2일 처방약 E 복용 시작 관리'])
  await user.click(within(older).getByText('지난 약 변경 2건 보기'))
  expect(older.open).toBe(false)
  await user.type(input('약 이름'), '이전에 바꾼 약')
  await user.click(screen.getByRole('radio', { name: '용량 줄임' }))
  fireEvent.change(input('바뀐 날'), { target: { value: '2026-08-25' } })
  await user.click(screen.getByRole('button', { name: '변경 내용 저장' }))
  await screen.findByText('약 변경을 저장했어요.')
  expect(older.open).toBe(false)
  await finishFeedback(user)
  await waitFor(() => expect(older.open).toBe(true))
  expect(within(older).getByText('지난 약 변경 3건 보기')).toBeTruthy()
  const saved = within(older)
    .getByRole('button', { name: '2026년 8월 25일 이전에 바꾼 약 용량 줄임 관리' })
    .closest('li')!
  await waitFor(() => expect(document.activeElement).toBe(saved))
  expect(api.addMedication).toHaveBeenCalledExactlyOnceWith({
    name: '이전에 바꾼 약',
    change_type: '감량',
    change_date: '2026-08-25',
  })
})

it.each(['약 변경', '질문 메모'] as const)(
  '%s 저장 안내를 닫고 다른 탭에 입력하면 늦은 기록 초점 이동이 입력을 방해하지 않는다',
  async (savedTab) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 })
    const user = userEvent.setup()
    render(<SchedulePage />)
    await ready()
    await user.click(screen.getByRole('tab', { name: savedTab }))
    if (savedTab === '약 변경') {
      await user.type(input('약 이름'), '새 처방약')
      await user.click(screen.getByRole('radio', { name: '복용 시작' }))
      fireEvent.change(input('바뀐 날'), { target: { value: '2026-09-28' } })
      await user.click(screen.getByRole('button', { name: '변경 내용 저장' }))
    } else {
      await user.type(input('다음 진료 때 묻고 싶은 것'), '저장할 질문')
      await user.click(screen.getByRole('button', { name: '질문 저장' }))
    }
    await screen.findByRole('dialog', { name: '저장했어요' })
    await ready()
    const frames = new Map<number, FrameRequestCallback>()
    let frameId = 0
    const scheduleFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frames.set(++frameId, callback)
        return frameId
      })
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id)
    })
    try {
      await finishFeedback(user)
      await user.click(
        screen.getByRole('tab', { name: savedTab === '약 변경' ? '질문 메모' : '약 변경' }),
      )
      const nextInput = input(savedTab === '약 변경' ? '다음 진료 때 묻고 싶은 것' : '약 이름')
      await user.click(nextInput)
      act(() => {
        for (const [id, callback] of frames) {
          frames.delete(id)
          callback(performance.now())
        }
      })
      expect(document.activeElement).toBe(nextInput)
      await user.type(nextInput, '이어 쓰는 내용 전체')
      expect(nextInput.value).toBe('이어 쓰는 내용 전체')
    } finally {
      scheduleFrame.mockRestore()
      cancelFrame.mockRestore()
    }
  },
)

it.each([1440, 360])(
  '%dpx에서 요약 조회 기간과 무관하게 오늘 기준 진료를 구분하고 지난 예정은 접지 않는다',
  async (width) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    window.history.replaceState(null, '', '#schedule?as_of=2026-08-15&period_start=2026-08-01')
    api.summary.mockResolvedValue({ period: { start: '2026-08-01', end: '2026-08-15' } })
    visits = [
      { id: 1, visit_date: '2026-10-05', status: '예정' },
      { id: 2, visit_date: '2026-09-01', status: '완료' },
      { id: 3, visit_date: '2026-09-20', status: '예정' },
      { id: 4, visit_date: '2026-09-29', status: '예정' },
      { id: 5, visit_date: '2026-09-22', status: '완료' },
      { id: 6, visit_date: '2026-08-15', status: '완료' },
      { id: 7, visit_date: '2026-09-28', status: '예정' },
      { id: 8, visit_date: '2026-09-05', status: '예정' },
    ]
    const user = userEvent.setup()
    render(<SchedulePage />)
    await ready()
    expect(screen.getByRole('form', { name: '진료 날짜 등록' })).toBeTruthy()
    const upcoming = within(screen.getByRole('region', { name: '다음 진료' }))
    expect(
      upcoming
        .getAllByRole('button', { name: /진료일 관리$/ })
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      '2026년 9월 28일 진료일 관리',
      '2026년 9월 29일 진료일 관리',
      '2026년 10월 5일 진료일 관리',
    ])
    expect(upcoming.getAllByRole('button', { name: /진료 완료$/ })).toHaveLength(1)
    const recent = within(screen.getByRole('region', { name: '최근 받은 진료' }))
    expect(recent.getAllByRole('button', { name: /진료일 관리$/ })).toHaveLength(1)
    expect(recent.getByRole('button', { name: '2026년 9월 22일 진료일 관리' })).toBeTruthy()
    const overdue = screen.getByRole('region', { name: '진료받으셨나요?' })
    expect(overdue.closest('details')).toBeNull()
    expect(
      within(overdue).getByRole('button', { name: '2026년 9월 20일 진료일 관리' }),
    ).toBeTruthy()
    expect(within(overdue).getByRole('button', { name: '2026년 9월 5일 진료일 관리' })).toBeTruthy()
    expect(within(overdue).getAllByRole('button', { name: /진료 완료$/ })).toHaveLength(2)
    const overdueManage = within(overdue).getByRole('button', {
      name: '2026년 9월 20일 진료일 관리',
    })
    const overdueComplete = within(overdue).getByRole('button', {
      name: '2026년 9월 20일 진료 완료',
    })
    expect(overdueManage.closest('li')).toBe(overdueComplete.closest('li'))
    expect(overdueManage.contains(overdueComplete)).toBe(false)
    expect(overdueComplete.contains(overdueManage)).toBe(false)
    const summary = screen.getByText('지난 진료 2건 보기')
    const past = summary.closest('details')!
    expect(past).toBeTruthy()
    expect(past.open).toBe(false)
    await user.click(summary)
    expect(past.open).toBe(true)
    expect(
      within(past)
        .getAllByRole('button', { name: /진료일 관리$/ })
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['2026년 9월 1일 진료일 관리', '2026년 8월 15일 진료일 관리'])
    expect(within(past).queryByRole('button', { name: /진료 완료$/ })).toBeNull()
    expect(api.updateVisit).not.toHaveBeenCalled()
    expect(api.deleteVisit).not.toHaveBeenCalled()
    await user.click(upcoming.getByRole('button', { name: '2026년 9월 28일 진료 완료' }))
    await user.click(
      within(screen.getByRole('alertdialog', { name: '진료 완료로 변경할까요?' })).getByRole(
        'button',
        { name: '진료 완료' },
      ),
    )
    await finishFeedback(user)
    expect(api.updateVisit).toHaveBeenCalledExactlyOnceWith(7, { status: '완료' })
    expect(
      within(screen.getByRole('region', { name: '최근 받은 진료' })).getByRole('button', {
        name: '2026년 9월 28일 진료일 관리',
      }),
    ).toBeTruthy()
  },
)

it.each([
  [
    '2026년 9월 1일 진료일 관리',
    '진료일을 삭제할까요?',
    '요약 기간이 달라질 수 있어요.',
    'deleteVisit',
    1,
  ],
  [
    '2026년 9월 21일 처방약 A 용량 늘림 관리',
    '약 변경 기록을 삭제할까요?',
    '그래프의 약 변경 표시도 사라져요.',
    'deleteMedication',
    3,
  ],
  [
    '2026년 9월 22일 기억해야 할 질문 관리',
    '질문을 삭제할까요?',
    '증상 통계는 바뀌지 않아요.',
    'deleteQuestion',
    4,
  ],
] as const)(
  '%s: 중앙 확인창 취소·실패·재시도와 다른 작성 내용을 보존한다',
  async (label, title, effect, method, id) => {
    const user = userEvent.setup()
    const pending = deferred<void>()
    api[method].mockImplementationOnce(() => pending.promise)
    const { container } = render(<SchedulePage />)
    await ready()
    fireEvent.change(input('진료받은 날'), { target: { value: '2026-09-28' } })
    await user.type(input('약 이름'), '작성 중인 약')
    await user.type(input('다음 진료 때 묻고 싶은 것'), '작성 중인 질문')

    const openDelete = async () => {
      const managerTitle =
        method === 'deleteVisit'
          ? '진료일 관리'
          : method === 'deleteMedication'
            ? '약 변경 기록 관리'
            : '질문 관리'
      if (!screen.queryByRole('dialog', { name: managerTitle }))
        await user.click(screen.getByRole('button', { name: label }))
      await user.click(
        within(screen.getByRole('dialog', { name: managerTitle })).getByRole('button', {
          name:
            method === 'deleteVisit'
              ? '진료일 삭제'
              : method === 'deleteMedication'
                ? '기록 삭제'
                : '질문 삭제',
        }),
      )
    }
    await openDelete()
    const firstDialog = screen.getByRole('alertdialog', { name: title })
    expect(firstDialog.tagName).toBe('DIALOG')
    expect(firstDialog.getAttribute('aria-modal')).toBe('true')
    expect(container.contains(firstDialog)).toBe(false)
    expect(firstDialog.textContent).toContain(effect)
    expect(firstDialog.textContent).not.toContain('요약지 계산이 바뀔 수 있어요.')
    expect(document.activeElement).toBe(within(firstDialog).getByRole('button', { name: '취소' }))
    await user.click(within(firstDialog).getByRole('button', { name: '취소' }))
    expect(api[method]).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: label })).toBeTruthy()
    if (method === 'deleteVisit')
      expect(screen.getByRole('dialog', { name: '진료일 관리' })).toBeTruthy()
    if (method === 'deleteMedication') {
      const manager = within(screen.getByRole('dialog', { name: '약 변경 기록 관리' }))
      expect(manager.getByText('처방약 A')).toBeTruthy()
      expect(manager.getByText(/용량 늘림/)).toBeTruthy()
      expect(manager.getByText('2026년 9월 21일')).toBeTruthy()
      expect(manager.queryByRole('textbox')).toBeNull()
      expect(manager.queryByRole('radio')).toBeNull()
    }
    if (method === 'deleteQuestion') {
      const manager = within(screen.getByRole('dialog', { name: '질문 관리' }))
      expect(manager.getByText('기억해야 할 질문')).toBeTruthy()
      expect(manager.getByText('2026년 9월 22일')).toBeTruthy()
      expect(manager.queryByRole('textbox')).toBeNull()
    }

    await openDelete()
    const dialog = screen.getByRole('alertdialog', { name: title })
    const confirm = within(dialog).getByRole('button', { name: '삭제하기' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(api[method]).toHaveBeenCalledExactlyOnceWith(id)
    expect(
      (within(dialog).getByRole('button', { name: '취소' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(screen.getByRole('alertdialog', { name: title })).toBe(dialog)
    await act(async () => {
      pending.reject(new Error('잠시 연결이 끊겼어요.'))
    })
    expect(within(dialog).getByRole('alert').textContent).toContain(
      '삭제하지 못했어요. 잠시 연결이 끊겼어요.',
    )
    expect(screen.getByRole('button', { name: label })).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: '다시 삭제하기' }))
    await ready()
    expect(api[method]).toHaveBeenCalledTimes(2)
    expect(api[method].mock.calls[0]).toEqual(api[method].mock.calls[1])
    expect(screen.queryByRole('dialog', { name: '진료일 관리' })).toBeNull()
    expect(screen.queryByRole('dialog', { name: '약 변경 기록 관리' })).toBeNull()
    expect(screen.queryByRole('dialog', { name: '질문 관리' })).toBeNull()
    expect(
      within(screen.getByRole('dialog', { name: '삭제했어요' })).queryByRole('heading'),
    ).toBeNull()
    if (method === 'deleteMedication')
      expect(screen.getByText('약 변경 기록을 삭제했어요.')).toBeTruthy()
    await finishFeedback(user)
    expect(screen.queryByRole('button', { name: label })).toBeNull()
    expect(input('진료받은 날').value).toBe('2026-09-28')
    expect(input('약 이름').value).toBe('작성 중인 약')
    expect(input('다음 진료 때 묻고 싶은 것').value).toBe('작성 중인 질문')
  },
)

it('예정 진료 삭제는 완료 진료처럼 요약 기간이 바뀐다고 안내하지 않는다', async () => {
  const user = userEvent.setup()
  render(<SchedulePage />)
  await ready()
  await user.click(screen.getByRole('button', { name: '2026년 9월 20일 진료일 관리' }))
  const manager = screen.getByRole('dialog', { name: '진료일 관리' })
  expect(within(manager).getByText('2026년 9월 20일')).toBeTruthy()
  await user.click(within(manager).getByRole('button', { name: '진료일 삭제' }))
  const dialog = screen.getByRole('alertdialog', { name: '진료일을 삭제할까요?' })
  expect(dialog.textContent).toContain('등록한 진료 예정일이 목록에서 사라져요.')
  expect(dialog.textContent).not.toContain('요약 기간이 달라질 수 있어요.')
  fireEvent(dialog, new Event('cancel', { cancelable: true }))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(screen.getByRole('dialog', { name: '진료일 관리' })).toBeTruthy()
  expect(api.deleteVisit).not.toHaveBeenCalled()
})

it.each(['visits', 'medications'] as const)(
  '%s 저장 실패 팝업에서 재시도하고 성공한 양식만 초기화한다',
  async (kind) => {
    const user = userEvent.setup()
    const pending = deferred<Visit & Medication>()
    const method = kind === 'visits' ? 'addVisit' : 'addMedication'
    api[method].mockImplementationOnce(() => pending.promise)
    render(<SchedulePage />)
    await ready()
    fireEvent.change(input('진료받은 날'), { target: { value: '2026-09-28' } })
    await user.type(input('약 이름'), '처방약 B')
    fireEvent.change(input('바뀐 날'), { target: { value: '2026-09-28' } })
    await user.click(screen.getByRole('radio', { name: '용량 줄임' }))
    await user.type(input('다음 진료 때 묻고 싶은 것'), '보존할 질문')
    const form = screen.getByRole('form', {
      name: kind === 'visits' ? '진료 날짜 등록' : '약 변경 기록',
    })
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(api[method]).toHaveBeenCalledTimes(1)
    expect(
      screen.getAllByRole('button', { name: kind === 'visits' ? '등록 중…' : '저장 중…' }),
    ).toHaveLength(1)
    const itemButtons = screen.getAllByRole('button', { name: / 관리$/ })
    expect(itemButtons).toHaveLength(4)
    for (const item of itemButtons) {
      expect((item as HTMLButtonElement).disabled).toBe(true)
      await user.click(item.querySelector('time')!)
    }
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(api[method]).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.reject(new Error('저장 연결 실패'))
    })
    const error = screen.getByRole('alertdialog', {
      name: kind === 'visits' ? '등록하지 못했어요' : '저장하지 못했어요',
    })
    expect(error.textContent).toContain('저장 연결 실패')
    expect(input('진료받은 날').value).toBe('2026-09-28')
    expect(input('약 이름').value).toBe('처방약 B')
    await user.click(
      within(error).getByRole('button', {
        name: kind === 'visits' ? '다시 등록하기' : '다시 저장하기',
      }),
    )
    await ready()
    expect(api[method]).toHaveBeenCalledTimes(2)
    expect(api[method].mock.calls[0]).toEqual(api[method].mock.calls[1])
    expect(
      within(
        screen.getByRole('dialog', { name: kind === 'visits' ? '등록했어요' : '저장했어요' }),
      ).queryByRole('heading'),
    ).toBeNull()
    await finishFeedback(user)
    expect(input('진료받은 날').value).toBe('2026-09-28')
    expect(input('약 이름').value).toBe(kind === 'medications' ? '' : '처방약 B')
    expect(input('바뀐 날').value).toBe('2026-09-28')
    const changeChoices = within(screen.getByRole('group', { name: '어떻게 바뀌었나요?' }))
    if (kind === 'medications')
      expect(changeChoices.queryByRole('radio', { checked: true })).toBeNull()
    else
      expect(
        (changeChoices.getByRole('radio', { name: '용량 줄임' }) as HTMLInputElement).checked,
      ).toBe(true)
    expect(input('다음 진료 때 묻고 싶은 것').value).toBe('보존할 질문')
    expect(
      screen.getByRole('button', {
        name:
          kind === 'visits'
            ? '2026년 9월 28일 진료일 관리'
            : '2026년 9월 28일 처방약 B 용량 줄임 관리',
      }),
    ).toBeTruthy()
  },
)

it('진료 완료는 취소하거나 실패한 창에서 재시도할 수 있고 성공해야 상태를 바꾼다', async () => {
  const user = userEvent.setup()
  const pending = deferred<Visit>()
  api.updateVisit.mockImplementationOnce(() => pending.promise)
  render(<SchedulePage />)
  await ready()
  await user.type(input('약 이름'), '보존할 약')
  await user.click(screen.getByRole('button', { name: '2026년 9월 20일 진료 완료' }))
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '취소' }))
  expect(api.updateVisit).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '2026년 9월 20일 진료 완료' }))
  const dialog = screen.getByRole('alertdialog', { name: '진료 완료로 변경할까요?' })
  const confirm = within(dialog).getByRole('button', { name: '진료 완료' })
  fireEvent.click(confirm)
  fireEvent.click(confirm)
  expect(api.updateVisit).toHaveBeenCalledExactlyOnceWith(2, { status: '완료' })
  fireEvent(dialog, new Event('cancel', { cancelable: true }))
  expect(screen.getByRole('alertdialog')).toBe(dialog)
  await act(async () => {
    pending.reject(new Error('완료 저장 실패'))
  })
  expect(within(dialog).getByRole('alert').textContent).toContain('완료 저장 실패')
  expect(screen.getByRole('button', { name: '2026년 9월 20일 진료 완료' })).toBeTruthy()
  await user.click(within(dialog).getByRole('button', { name: '다시 변경하기' }))
  await ready()
  await finishFeedback(user)
  expect(api.updateVisit).toHaveBeenCalledTimes(2)
  expect(visits.find((visit) => visit.id === 2)?.status).toBe('완료')
  expect(screen.queryByRole('button', { name: '2026년 9월 20일 진료 완료' })).toBeNull()
  expect(input('약 이름').value).toBe('보존할 약')
})

it.each([1440, 360])(
  '%dpx에서 관리 중 예정으로 변경을 취소하면 관리로 돌아오고 실패 후 성공해야 닫는다',
  async (width) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    const user = userEvent.setup()
    api.updateVisit.mockRejectedValueOnce(new Error('예정 상태 저장 실패'))
    render(<SchedulePage />)
    await ready()
    fireEvent.change(input('진료받은 날'), { target: { value: '2026-09-26' } })
    await user.click(screen.getByRole('button', { name: '2026년 9월 1일 진료일 관리' }))
    let manager = screen.getByRole('dialog', { name: '진료일 관리' })
    expect(within(manager).getByText('2026년 9월 1일')).toBeTruthy()
    expect(manager.textContent).toContain('완료')
    await user.click(within(manager).getByRole('button', { name: '예정으로 변경' }))
    const title = '진료 예정으로 변경할까요?'
    await user.click(
      within(screen.getByRole('alertdialog', { name: title })).getByRole('button', {
        name: '취소',
      }),
    )
    expect(api.updateVisit).not.toHaveBeenCalled()
    manager = screen.getByRole('dialog', { name: '진료일 관리' })
    expect(manager.textContent).toContain('완료')
    await user.click(within(manager).getByRole('button', { name: '예정으로 변경' }))
    let confirmation = screen.getByRole('alertdialog', { name: title })
    await user.click(within(confirmation).getByRole('button', { name: '예정으로 변경' }))
    expect(api.updateVisit).toHaveBeenCalledExactlyOnceWith(1, { status: '예정' })
    expect(within(confirmation).getByRole('alert').textContent).toContain('예정 상태 저장 실패')
    expect(visits.find((visit) => visit.id === 1)?.status).toBe('완료')
    await user.click(within(confirmation).getByRole('button', { name: '취소' }))
    manager = screen.getByRole('dialog', { name: '진료일 관리' })
    expect(manager.textContent).toContain('완료')
    await user.click(within(manager).getByRole('button', { name: '예정으로 변경' }))
    confirmation = screen.getByRole('alertdialog', { name: title })
    await user.click(within(confirmation).getByRole('button', { name: '예정으로 변경' }))
    await finishFeedback(user)
    expect(api.updateVisit).toHaveBeenCalledTimes(2)
    expect(api.updateVisit.mock.calls[0]).toEqual(api.updateVisit.mock.calls[1])
    expect(screen.queryByRole('dialog', { name: '진료일 관리' })).toBeNull()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(input('진료받은 날').value).toBe('2026-09-26')
    expect(
      within(screen.getByRole('region', { name: '진료받으셨나요?' })).getByRole('button', {
        name: '2026년 9월 1일 진료일 관리',
      }),
    ).toBeTruthy()
  },
)

it('일정 화면을 벗어나면 확인창을 닫고 미저장 입력은 유지한다', async () => {
  const user = userEvent.setup()
  const { rerender } = render(<SchedulePage />)
  await ready()
  await user.type(input('약 이름'), '이동해도 보존할 약')
  await user.click(screen.getByRole('button', { name: '2026년 9월 22일 기억해야 할 질문 관리' }))
  await user.click(
    within(screen.getByRole('dialog', { name: '질문 관리' })).getByRole('button', {
      name: '질문 삭제',
    }),
  )
  expect(screen.getByRole('alertdialog')).toBeTruthy()
  rerender(<SchedulePage active={false} />)
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(document.querySelector('dialog[open]')).toBeNull()
  rerender(<SchedulePage active />)
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(input('약 이름').value).toBe('이동해도 보존할 약')
  expect(api.deleteQuestion).not.toHaveBeenCalled()
})

it('숨겨진 일정 화면의 조회 실패는 다른 화면에 팝업을 띄우지 않고 돌아오면 재시도한다', async () => {
  const user = userEvent.setup()
  api.questions.mockRejectedValueOnce(new Error('질문 조회 실패'))
  const { rerender } = render(<SchedulePage active={false} />)
  await ready()
  expect(document.querySelector('dialog[open]')).toBeNull()
  rerender(<SchedulePage active />)
  const dialog = screen.getByRole('alertdialog', { name: '기록을 불러오지 못했어요' })
  expect(dialog.textContent).toContain('질문 조회 실패')
  await user.click(within(dialog).getByRole('button', { name: '다시 불러오기' }))
  await ready()
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(api.questions).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('button', { name: '2026년 9월 22일 기억해야 할 질문 관리' })).toBeTruthy()
})

it('다른 화면에서 저장 응답이 도착하면 목록을 반영하고 돌아왔을 때 완료를 알린다', async () => {
  const user = userEvent.setup()
  const pending = deferred<Visit>()
  api.addVisit.mockImplementationOnce(() => pending.promise)
  const { rerender } = render(<SchedulePage />)
  await ready()
  fireEvent.change(input('진료받은 날'), { target: { value: '2026-09-28' } })
  await user.click(screen.getByRole('button', { name: '받은 진료 등록', exact: true }))
  expect(api.addVisit).toHaveBeenCalledExactlyOnceWith({ visit_date: '2026-09-28', status: '완료' })
  rerender(<SchedulePage active={false} />)
  const saved: Visit = { id: 20, visit_date: '2026-09-28', status: '완료' }
  visits.push(saved)
  await act(async () => {
    pending.resolve(saved)
  })
  await ready()
  expect(document.querySelector('dialog[open]')).toBeNull()
  rerender(<SchedulePage active />)
  expect(screen.getByRole('dialog', { name: '등록했어요' })).toBeTruthy()
  await finishFeedback(user)
  expect(input('진료받은 날').value).toBe('2026-09-28')
  expect(screen.getByRole('button', { name: '2026년 9월 28일 진료일 관리' })).toBeTruthy()
})

it('다른 화면에서 도착한 저장 실패는 돌아왔을 때 알리고 같은 내용으로 재시도한다', async () => {
  const user = userEvent.setup()
  const pending = deferred<Visit>()
  api.addVisit.mockImplementationOnce(() => pending.promise)
  const { rerender } = render(<SchedulePage />)
  await ready()
  fireEvent.change(input('진료받은 날'), { target: { value: '2026-09-28' } })
  await user.click(screen.getByRole('button', { name: '받은 진료 등록', exact: true }))
  rerender(<SchedulePage active={false} />)
  await act(async () => {
    pending.reject(new Error('응답이 늦어진 저장 실패'))
  })
  expect(document.querySelector('dialog[open]')).toBeNull()
  api.questions.mockRejectedValueOnce(new Error('백그라운드 질문 조회 실패'))
  await act(async () => {
    window.dispatchEvent(new Event('itda-final-updated'))
  })
  await ready()
  rerender(<SchedulePage active />)
  const dialog = screen.getByRole('alertdialog', { name: '등록하지 못했어요' })
  expect(dialog.textContent).toContain('응답이 늦어진 저장 실패')
  expect(input('진료받은 날').value).toBe('2026-09-28')
  await user.click(within(dialog).getByRole('button', { name: '다시 등록하기' }))
  await ready()
  await finishFeedback(user)
  expect(api.addVisit).toHaveBeenCalledTimes(2)
  expect(api.addVisit.mock.calls[0]).toEqual(api.addVisit.mock.calls[1])
  expect(input('진료받은 날').value).toBe('2026-09-28')
})

it.each([
  [
    'deleteQuestion',
    '2026년 9월 22일 기억해야 할 질문 관리',
    '질문을 삭제할까요?',
    '삭제하기',
    '다시 삭제하기',
  ],
  [
    'updateVisit',
    '2026년 9월 20일 진료 완료',
    '진료 완료로 변경할까요?',
    '진료 완료',
    '다시 변경하기',
  ],
] as const)(
  '%s 처리 중 화면을 떠났다면 돌아온 확인창에서 늦은 실패를 재시도한다',
  async (method, trigger, title, submit, retry) => {
    const user = userEvent.setup()
    const pending = deferred<never>()
    api[method].mockImplementationOnce(() => pending.promise)
    const { rerender } = render(<SchedulePage />)
    await ready()
    await user.click(screen.getByRole('button', { name: trigger }))
    if (method === 'deleteQuestion')
      await user.click(
        within(screen.getByRole('dialog', { name: '질문 관리' })).getByRole('button', {
          name: '질문 삭제',
        }),
      )
    await user.click(
      within(screen.getByRole('alertdialog', { name: title })).getByRole('button', {
        name: submit,
      }),
    )
    rerender(<SchedulePage active={false} />)
    expect(document.querySelector('dialog[open]')).toBeNull()
    await act(async () => {
      pending.reject(new Error('처리 응답 연결 실패'))
    })
    expect(document.querySelector('dialog[open]')).toBeNull()
    rerender(<SchedulePage active />)
    const dialog = screen.getByRole('alertdialog', { name: title })
    expect(within(dialog).getByRole('alert').textContent).toContain('처리 응답 연결 실패')
    await user.click(within(dialog).getByRole('button', { name: retry }))
    await ready()
    await finishFeedback(user)
    expect(api[method]).toHaveBeenCalledTimes(2)
    expect(api[method].mock.calls[0]).toEqual(api[method].mock.calls[1])
  },
)

it('저장 뒤 일부 목록 갱신이 실패해도 저장 완료를 알리고 다시 불러올 수 있다', async () => {
  const user = userEvent.setup()
  render(<SchedulePage />)
  await ready()
  api.visits.mockRejectedValueOnce(new Error('진료일 갱신 실패'))
  await user.type(input('다음 진료 때 묻고 싶은 것'), '새로 저장할 질문')
  await user.click(screen.getByRole('button', { name: '질문 저장' }))
  await ready()
  expect(screen.getByRole('dialog', { name: '저장했어요' }).textContent).toContain(
    '질문을 저장했어요.',
  )
  await finishFeedback(user)
  expect(screen.getByRole('button', { name: '2026년 9월 28일 새로 저장할 질문 관리' })).toBeTruthy()
  expect(input('다음 진료 때 묻고 싶은 것').value).toBe('')
  await user.click(screen.getByRole('button', { name: '기록 다시 불러오기' }))
  await ready()
  expect(screen.queryByRole('button', { name: '기록 다시 불러오기' })).toBeNull()
})

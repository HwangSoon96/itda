import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecordPage } from '../src/features/records/RecordPage'
import { SchedulePage } from '../src/features/schedule/SchedulePage'
import { localToday } from '../src/shared/lib/date'
import type { EventCard, Health, Medication, MemoResult, Question, Visit } from '../src/api/types'

const api = vi.hoisted(() => ({
  memoRevisions: vi.fn(),
  memos: vi.fn(),
  createMemo: vi.fn(),
  confirmMemo: vi.fn(),
  retryMemo: vi.fn(),
  addEvent: vi.fn(),
  updateVisit: vi.fn(),
  visits: vi.fn(),
  addVisit: vi.fn(),
  deleteVisit: vi.fn(),
  medications: vi.fn(),
  addMedication: vi.fn(),
  deleteMedication: vi.fn(),
  summary: vi.fn(),
  questions: vi.fn(),
  addQuestion: vi.fn(),
  deleteQuestion: vi.fn(),
}))
vi.mock('../src/api', () => ({ api }))

const health: Health = {
  workspace_id: 'test-space',
  ok: true,
  ai_available: true,
  model_name: 'itda-a',
  allow_lan: false,
  emergency_keywords: ['숨을 안 쉬', '머리를 부딪'],
  emergency_message: '응급 상황이면 즉시 119에 연락하세요.',
  ai_notice: 'AI가 정리한 내용이에요. 틀린 부분은 고쳐 주세요.',
  disclaimer: '보호자 일지 자동 정리본입니다.',
}
const recordDate = '2026-09-24'
const source = '밤에 깨서 현관문을 열려고 하셨어요. 식사는 잘 하셨어요.'
const baseEvent: EventCard = {
  type: '배회·출입문 시도',
  status: '있었음',
  time_expr: '밤에',
  count: 1,
  evidence: '밤에 깨서 현관문을 열려고 하셨어요.',
  model_event_index: 0,
}
const memo = (overrides: Partial<MemoResult> = {}): MemoResult => ({
  memo_id: 41,
  status: '확인 대기',
  emergency: { matched: false, message: null },
  text: source,
  record_date: recordDate,
  events: [{ ...baseEvent }],
  ...overrides,
})
let visitStore: Visit[]
let medicationStore: Medication[]
let questionStore: Question[]
let result: MemoResult

beforeEach(() => {
  vi.resetAllMocks()
  window.history.replaceState(null, '', '#record')
  result = memo()
  visitStore = []
  medicationStore = []
  questionStore = []
  api.memos.mockResolvedValue([])
  api.memoRevisions.mockResolvedValue([])
  api.updateVisit.mockImplementation(async (id: number, body: { status: Visit['status'] }) => {
    const saved = { ...visitStore.find((item) => item.id === id)!, status: body.status }
    visitStore = visitStore.map((item) => (item.id === id ? saved : item))
    return saved
  })
  api.createMemo.mockImplementation(async () => result)
  api.confirmMemo.mockImplementation(async (_id: number, body: { events: EventCard[] }) => {
    const saved: MemoResult = { ...result, status: '확인 완료', events: body.events }
    api.memos.mockResolvedValue([saved])
    return saved
  })
  api.retryMemo.mockImplementation(async () => memo())
  api.visits.mockImplementation(async () => [...visitStore])
  api.medications.mockImplementation(async () => [...medicationStore])
  api.questions.mockImplementation(async () => [...questionStore])
  api.summary.mockResolvedValue({ period: { start: '2026-08-20', end: '2026-09-27' } })
  api.addVisit.mockImplementation(async (body: Omit<Visit, 'id'>) => {
    const saved = { id: 1, ...body }
    visitStore.push(saved)
    return saved
  })
  api.addMedication.mockImplementation(async (body: Omit<Medication, 'id'>) => {
    const saved = { id: 2, ...body }
    medicationStore.push(saved)
    return saved
  })
  api.addQuestion.mockImplementation(async (body: { text: string }) => {
    const saved = { id: 3, ...body, created_at: localToday() }
    questionStore.push(saved)
    return saved
  })
  api.deleteVisit.mockImplementation(async (id: number) => {
    visitStore = visitStore.filter((item) => item.id !== id)
  })
  api.deleteMedication.mockImplementation(async (id: number) => {
    medicationStore = medicationStore.filter((item) => item.id !== id)
  })
  api.deleteQuestion.mockImplementation(async (id: number) => {
    questionStore = questionStore.filter((item) => item.id !== id)
  })
})
afterEach(cleanup)

async function enterMemo(user: ReturnType<typeof userEvent.setup>, text = source) {
  fireEvent.change(screen.getByLabelText('기록 날짜'), {
    target: { value: recordDate },
  })
  await user.type(screen.getByLabelText('어떤 일이 있었나요?'), text)
  await user.click(screen.getByRole('button', { name: '저장하고 정리하기' }))
}
async function editRecord(
  user: ReturnType<typeof userEvent.setup>,
  name = '1번 배회·출입문 시도 수정',
) {
  await user.click(await screen.findByRole('button', { name }))
  return within(screen.getByRole('dialog', { name: '내용 수정' }))
}
function selectManualEvidence(excerpt: string) {
  const manual = within(screen.getByRole('dialog', { name: '빠진 사건 추가' }))
  const sourceInput = manual.getByRole('textbox', {
    name: '원문에서 근거 선택',
  }) as HTMLTextAreaElement
  const start = sourceInput.value.indexOf(excerpt)
  expect(start).toBeGreaterThanOrEqual(0)
  sourceInput.focus()
  sourceInput.setSelectionRange(start, start + excerpt.length)
  fireEvent.select(sourceInput)
  return sourceInput
}
async function savedRecord(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('heading', { name: '오늘 하루는 어떠셨나요?' })
  expect((screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement).value).toBe('')
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
  await screen.findByRole('heading', { name: '확인 완료한 내용' })
}
async function dismissRecordError(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '확인' }))
}
async function renderSchedule() {
  window.history.replaceState(null, '', '#schedule?as_of=2026-09-27')
  render(<SchedulePage />)
  await waitFor(() => expect(screen.queryByText('저장한 기록을 모으고 있어요…')).toBeNull())
}
async function openVisitForm(user: ReturnType<typeof userEvent.setup>) {
  const feedback = screen.queryByRole('dialog', { name: /등록했어요|저장했어요|변경했어요/ })
  if (feedback) await user.click(within(feedback).getByRole('button', { name: '확인' }))
  await user.click(screen.getByRole('tab', { name: '진료일' }))
  expect(screen.getByRole('form', { name: '진료 날짜 등록' })).toBeTruthy()
}
async function openMedicationForm(user: ReturnType<typeof userEvent.setup>) {
  const feedback = screen.queryByRole('dialog', { name: /등록했어요|저장했어요|변경했어요/ })
  if (feedback) await user.click(within(feedback).getByRole('button', { name: '확인' }))
  await user.click(screen.getByRole('tab', { name: '약 변경' }))
  expect(screen.getByLabelText('약 이름')).toBeTruthy()
}
async function openQuestionForm(user: ReturnType<typeof userEvent.setup>) {
  const feedback = screen.queryByRole('dialog', { name: /등록했어요|저장했어요|변경했어요/ })
  if (feedback) await user.click(within(feedback).getByRole('button', { name: '확인' }))
  await user.click(screen.getByRole('tab', { name: '질문 메모' }))
}
const tomorrow = () => {
  const date = new Date(`${localToday()}T12:00:00`)
  date.setDate(date.getDate() + 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

describe('기록: 원문에서 보호자 승인까지', () => {
  it('카드 수정과 삭제를 승인 요청에 반영하고 원문 및 메모 ID를 보존한다', async () => {
    const user = userEvent.setup()
    result = memo({
      events: [{ ...baseEvent }, { ...baseEvent, type: '야간 각성', model_event_index: 1 }],
    })
    render(<RecordPage health={health} />)
    await enterMemo(user)
    await screen.findByRole('heading', { name: /^정리된 내용 \d+건$/ })
    expect(api.createMemo).toHaveBeenCalledWith({
      text: source,
      record_date: recordDate,
      request_id: expect.any(String),
    })
    expect(
      within(screen.getByRole('dialog', { name: '정리된 내용', exact: true })).queryByRole(
        'combobox',
      ),
    ).toBeNull()
    const editor = await editRecord(user, '2번 야간 각성 수정')
    await user.selectOptions(editor.getByLabelText('유형'), '불안')
    expect(editor.queryByLabelText('관찰 상태')).toBeNull()
    expect(editor.queryByLabelText(/^근거 구절/)).toBeNull()
    expect(editor.getByRole('region', { name: '선택한 근거' }).textContent).toContain(
      baseEvent.evidence,
    )
    fireEvent.change(editor.getByLabelText(/^횟수/), { target: { value: '3' } })
    fireEvent.change(editor.getByLabelText(/^원문 시간 표현/), { target: { value: '밤' } })
    await user.click(editor.getByRole('button', { name: '수정 적용' }))
    expect(screen.getByRole('heading', { name: '불안', exact: true })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '야간 각성', exact: true })).toBeNull()
    await user.click(screen.getByRole('button', { name: '1번 배회·출입문 시도 카드 삭제' }))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: '카드 삭제' }),
    )
    await user.click(screen.getByRole('button', { name: '확인 완료' }))
    await savedRecord(user)
    expect(api.confirmMemo).toHaveBeenCalledExactlyOnceWith(41, {
      events: [
        {
          ...baseEvent,
          type: '불안',
          count: 3,
          time_expr: '밤',
          model_event_index: 1,
        },
      ],
    })
    expect(api.createMemo).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('region', { name: '확인 완료한 사건' }).textContent).toContain('3회')
    expect(screen.getByLabelText('근거 원문').textContent).toContain(baseEvent.evidence)
    expect(
      screen.getByRole('heading', { name: '작성한 메모' }).closest('section')?.textContent,
    ).toContain(source)
  })

  it('출처 번호가 없는 이전 기록은 임의 번호나 null을 붙이지 않고 확인한다', async () => {
    const user = userEvent.setup()
    const legacy = { ...baseEvent }
    delete legacy.model_event_index
    result = memo({ events: [legacy] })
    render(<RecordPage health={health} />)
    await enterMemo(user)
    await user.click(await screen.findByRole('button', { name: '확인 완료' }))
    await savedRecord(user)
    expect(api.confirmMemo).toHaveBeenCalledExactlyOnceWith(41, { events: [legacy] })
    expect(Object.hasOwn(api.confirmMemo.mock.calls[0][1].events[0], 'model_event_index')).toBe(
      false,
    )
  })

  it('사건의 시간 표현을 비워도 선택한 메모 날짜로 확인하고 별도 날짜를 요청하지 않는다', async () => {
    const user = userEvent.setup()
    render(<RecordPage health={health} />)
    await enterMemo(user)
    const editor = await editRecord(user)
    const dialog = screen.getByRole('dialog', { name: '내용 수정' })
    expect(dialog.querySelector('input[type="date"]')).toBeNull()
    expect(editor.queryByRole('checkbox')).toBeNull()
    await user.clear(editor.getByLabelText(/^원문 시간 표현/))
    await user.click(editor.getByRole('button', { name: '수정 적용' }))
    await user.click(screen.getByRole('button', { name: '확인 완료' }))
    await savedRecord(user)
    expect(api.confirmMemo).toHaveBeenCalledExactlyOnceWith(41, {
      events: [{ ...baseEvent, time_expr: null }],
    })
    expect(
      screen.getByRole('heading', { name: '작성한 메모' }).closest('section')?.querySelector('time')
        ?.dateTime,
    ).toBe(recordDate)
    expect((screen.getByLabelText('기록 날짜') as HTMLInputElement).value).toBe(localToday())
    expect((screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement).value).toBe('')
    expect(screen.getByRole('region', { name: '확인 완료한 사건' }).textContent).toContain(
      '시간 표현 없음',
    )
  })

  it('빈 추출 결과를 확인 완료로 저장하되 없었음 사건을 만들어 보내지 않는다', async () => {
    const user = userEvent.setup()
    result = memo({ text: '오늘 함께 사진을 보았어요.', events: [] })
    render(<RecordPage health={health} />)
    await enterMemo(user, result.text)
    await screen.findByRole('heading', { name: '정리된 사건이 없어요' })
    expect(api.confirmMemo).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '확인 완료' }))
    await savedRecord(user)
    expect(api.confirmMemo).toHaveBeenCalledExactlyOnceWith(41, { events: [] })
    expect(screen.getByRole('region', { name: '확인 완료한 사건' }).textContent).toContain(
      '원문만 확인 완료',
    )
  })

  it('확인 대기 메모에 직접 추가한 사건도 검토를 마친 뒤 기존 카드와 함께 승인한다', async () => {
    const user = userEvent.setup()
    render(<RecordPage health={health} />)
    await enterMemo(user)
    await user.click(await screen.findByRole('button', { name: '빠진 사건 추가' }))
    const manual = within(screen.getByRole('dialog', { name: '빠진 사건 추가' }))
    expect((screen.getByRole('button', { name: '확인 완료' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(manual.queryByLabelText(/^근거 구절/)).toBeNull()
    const selectedEvidence = '밤에 깨서'
    expect(selectManualEvidence(selectedEvidence).value).toBe(source)
    expect(manual.getByRole('region', { name: '선택한 근거' }).textContent).toContain(
      selectedEvidence,
    )
    await user.clear(manual.getByLabelText(/^횟수/))
    await user.type(manual.getByLabelText(/^횟수/), '2')
    await user.click(manual.getByRole('button', { name: '사건 추가' }))
    expect(api.addEvent).not.toHaveBeenCalled()
    expect(api.confirmMemo).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '확인 완료' }))
    await savedRecord(user)
    expect(api.confirmMemo).toHaveBeenCalledExactlyOnceWith(41, {
      events: [
        baseEvent,
        {
          type: '야간 각성',
          status: '있었음',
          count: 2,
          time_expr: null,
          evidence: selectedEvidence,
          model_event_index: null,
        },
      ],
    })
    expect(api.createMemo).toHaveBeenCalledTimes(1)
  })

  it('확인 완료 메모의 누락 사건 추가가 실패하면 입력을 보존하고 같은 메모에 재시도한다', async () => {
    const user = userEvent.setup()
    const approved = memo({ status: '확인 완료' })
    const added: EventCard = {
      type: '야간 각성',
      status: '있었음',
      count: 1,
      time_expr: null,
      evidence: '밤에 깨서',
      model_event_index: null,
    }
    api.memos.mockResolvedValue([approved])
    api.addEvent
      .mockRejectedValueOnce(new Error('사건 저장 응답을 받지 못했어요.'))
      .mockResolvedValueOnce({ ...approved, events: [baseEvent, added] })
    render(<RecordPage health={health} />)
    await user.click(screen.getByRole('button', { name: '지난 기록 찾기' }))
    const history = within(screen.getByRole('complementary', { name: '최근 기록' }))
    await user.click(await history.findByRole('button', { name: /확인 완료/ }))
    await user.click(screen.getByRole('button', { name: '빠진 사건 추가' }))
    const manual = within(screen.getByRole('dialog', { name: '빠진 사건 추가' }))
    expect(manual.queryByLabelText(/^근거 구절/)).toBeNull()
    selectManualEvidence(added.evidence)
    await user.click(screen.getByRole('button', { name: '사건 추가' }))
    expect((await screen.findByRole('alert')).textContent).toContain('사건 저장 응답')
    expect(manual.getByRole('region', { name: '선택한 근거' }).textContent).toContain(
      added.evidence,
    )
    expect(screen.getByRole('region', { name: '확인 완료한 사건' }).textContent).toContain(
      baseEvent.type,
    )
    await user.click(screen.getByRole('button', { name: '사건 추가' }))
    await screen.findByText('빠진 사건을 추가했어요.')
    expect(api.addEvent).toHaveBeenCalledTimes(2)
    expect(api.addEvent.mock.calls[0]).toEqual([{ memo_id: 41, ...added }])
    expect(api.addEvent.mock.calls[1]).toEqual(api.addEvent.mock.calls[0])
    const saved = screen.getByRole('region', { name: '확인 완료한 사건' })
    expect(saved.textContent).toContain('2개 사건을 확인했어요.')
    expect(saved.textContent).toContain('시간 표현 없음')
    expect(
      screen.getByRole('heading', { name: '작성한 메모' }).closest('section')?.querySelector('time')
        ?.dateTime,
    ).toBe(recordDate)
    expect((screen.getByLabelText('기록 날짜') as HTMLInputElement).value).toBe(localToday())
    expect((screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement).value).toBe('')
    expect(api.createMemo).not.toHaveBeenCalled()
    expect(api.confirmMemo).not.toHaveBeenCalled()
  })

  it('기간 필터는 저장 시각과 확인 상태에 관계없이 메모의 기록 날짜로 찾는다', async () => {
    const user = userEvent.setup()
    api.memos.mockResolvedValue([
      {
        ...memo({
          memo_id: 51,
          text: '늦게 저장한 관찰',
          record_date: '2026-09-22',
          status: '확인 완료',
        }),
        created_at: '2026-09-24T12:00:00',
      },
      memo({ memo_id: 52, text: '아직 확인하지 않은 관찰', record_date: '2026-09-22' }),
      {
        ...memo({
          memo_id: 53,
          text: '다른 날의 관찰',
          record_date: '2026-09-21',
          status: '확인 완료',
        }),
        created_at: '2026-09-22T12:00:00',
      },
      memo({
        memo_id: 54,
        text: '그날의 빈 메모',
        record_date: '2026-09-22',
        status: '확인 완료',
        events: [],
      }),
    ])
    render(<RecordPage health={health} />)
    await user.click(screen.getByRole('button', { name: '지난 기록 찾기' }))
    const history = within(screen.getByRole('complementary', { name: '최근 기록' }))
    await history.findByText('늦게 저장한 관찰')
    await user.click(history.getByRole('button', { name: '직접 선택' }))
    fireEvent.change(history.getByLabelText('시작일'), { target: { value: '2026-09-22' } })
    fireEvent.change(history.getByLabelText('종료일'), { target: { value: '2026-09-22' } })
    expect(history.getByText('늦게 저장한 관찰')).toBeTruthy()
    expect(history.getByText('아직 확인하지 않은 관찰')).toBeTruthy()
    expect(history.getByText('그날의 빈 메모')).toBeTruthy()
    expect(history.queryByText('다른 날의 관찰')).toBeNull()
    await user.selectOptions(history.getByLabelText('확인 상태'), '확인 대기')
    expect(history.getByText('아직 확인하지 않은 관찰')).toBeTruthy()
    expect(history.queryByText('늦게 저장한 관찰')).toBeNull()
    expect(history.queryByText('그날의 빈 메모')).toBeNull()
  })

  it('정리 실패 뒤 같은 저장 메모를 재시도하며 대기 중에도 원문을 유지한다', async () => {
    const user = userEvent.setup()
    result = memo({ status: '정리 실패', events: [], error: 'Ollama 연결을 확인해 주세요.' })
    let finish!: (value: MemoResult) => void
    api.retryMemo.mockImplementation(
      () =>
        new Promise<MemoResult>((resolve) => {
          finish = resolve
        }),
    )
    render(<RecordPage health={health} />)
    await enterMemo(user)
    await screen.findByRole('heading', { name: '정리하지 못했어요' })
    expect(
      within(screen.getByRole('heading', { name: '작성한 메모' }).closest('section')!).getByText(
        source,
      ),
    ).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(
      within(screen.getByRole('heading', { name: '작성한 메모' }).closest('section')!).getByText(
        source,
      ),
    ).toBeTruthy()
    expect((screen.getByRole('button', { name: '다시 시도' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(api.retryMemo).toHaveBeenCalledExactlyOnceWith(41)
    await act(async () => {
      finish(memo())
    })
    await screen.findByRole('heading', { name: /^정리된 내용 \d+건$/ })
    expect(api.createMemo).toHaveBeenCalledTimes(1)
    expect(api.confirmMemo).not.toHaveBeenCalled()
  })

  it('재시도 응답이 유실되어도 최근 기록에서 같은 메모의 최신 결과를 다시 연다', async () => {
    const user = userEvent.setup()
    result = memo({ status: '정리 실패', events: [], error: '첫 정리 실패' })
    api.retryMemo.mockRejectedValueOnce(new Error('재시도 응답 연결이 끊겼어요.'))
    render(<RecordPage health={health} />)
    await enterMemo(user)
    await user.click(await screen.findByRole('button', { name: '다시 시도' }))
    expect((await screen.findByRole('alertdialog')).textContent).toContain('재시도 응답 연결')
    await dismissRecordError(user)
    expect(screen.getByRole('heading', { name: '정리하지 못했어요' })).toBeTruthy()
    expect(
      within(screen.getByRole('heading', { name: '작성한 메모' }).closest('section')!).getByText(
        source,
      ),
    ).toBeTruthy()

    // The server completed retry although the browser did not receive its response.
    api.memos.mockResolvedValue([memo()])
    const beforeHistory = api.memos.mock.calls.length
    await user.click(screen.getByRole('button', { name: '지난 기록 찾기' }))
    const history = within(screen.getByRole('complementary', { name: '최근 기록' }))
    await waitFor(() => expect(api.memos).toHaveBeenCalledTimes(beforeHistory + 1))
    await user.click(await history.findByRole('button', { name: /확인 대기/ }))
    await screen.findByRole('heading', { name: /^정리된 내용 \d+건$/ })
    expect(screen.getByLabelText('근거 원문').textContent).toContain(baseEvent.evidence)
    expect(api.retryMemo).toHaveBeenCalledExactlyOnceWith(41)
    expect(api.createMemo).toHaveBeenCalledTimes(1)
    expect(api.confirmMemo).not.toHaveBeenCalled()
  })

  it('지난 기록에서 같은 메모를 다시 열면 확인 중인 수정을 그대로 이어서 보여 준다', async () => {
    const user = userEvent.setup()
    api.memos.mockResolvedValue([memo()])
    render(<RecordPage health={health} />)
    await enterMemo(user)
    const editor = await editRecord(user)
    fireEvent.change(editor.getByLabelText(/^횟수/), { target: { value: '3' } })
    await user.click(editor.getByRole('button', { name: '수정 적용' }))
    await user.click(
      within(screen.getByRole('dialog', { name: '정리된 내용', exact: true })).getByRole('button', {
        name: '닫기',
        exact: true,
      }),
    )
    await user.click(screen.getByRole('button', { name: '지난 기록 찾기' }))
    const history = within(screen.getByRole('complementary', { name: '최근 기록' }))
    await user.click(history.getByRole('button', { name: /확인 대기/ }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(
      within(screen.getByRole('dialog', { name: '정리된 내용', exact: true })).getByText('3회'),
    ).toBeTruthy()
    expect(api.createMemo).toHaveBeenCalledTimes(1)
    expect(api.confirmMemo).not.toHaveBeenCalled()
  })

  it('저장 응답을 잃어도 입력과 요청 ID를 유지하여 재전송 시 중복 저장을 막는다', async () => {
    const user = userEvent.setup()
    api.createMemo
      .mockRejectedValueOnce(new Error('연결이 끊겼어요.'))
      .mockResolvedValueOnce(memo())
    render(<RecordPage health={health} />)
    await enterMemo(user)
    expect((await screen.findByRole('alertdialog')).textContent).toContain(
      '입력한 내용은 남아 있어요',
    )
    await dismissRecordError(user)
    expect((screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement).value).toBe(source)
    const firstRequest = api.createMemo.mock.calls[0][0]
    await user.click(screen.getByRole('button', { name: '저장하고 정리하기' }))
    await screen.findByRole('heading', { name: /^정리된 내용 \d+건$/ })
    expect(api.createMemo.mock.calls[1][0]).toEqual(firstRequest)
  })

  it('잘못된 횟수·시간 표현은 승인하지 않고 근거 원문과 고친 카드 입력을 남긴다', async () => {
    const user = userEvent.setup()
    render(<RecordPage health={health} />)
    await enterMemo(user)
    const editor = await editRecord(user)
    expect(editor.queryByLabelText(/^근거 구절/)).toBeNull()
    const sourceInput = editor.getByRole('textbox', {
      name: '원문에서 근거 선택',
    }) as HTMLTextAreaElement
    expect(sourceInput.readOnly).toBe(true)
    expect(sourceInput.value).toBe(source)
    const evidence = editor.getByRole('region', { name: '선택한 근거' })
    expect(evidence.textContent).toContain(baseEvent.evidence)
    const count = editor.getByLabelText(/^횟수/) as HTMLInputElement
    await user.clear(count)
    await user.type(count, '0')
    await user.click(editor.getByRole('button', { name: '수정 적용' }))
    expect(count.checkValidity()).toBe(false)
    expect(api.confirmMemo).not.toHaveBeenCalled()
    await user.clear(count)
    await user.type(count, '2')
    const time = editor.getByLabelText(/^원문 시간 표현/) as HTMLInputElement
    fireEvent.change(time, { target: { value: '원문에 없는 시간' } })
    await user.click(editor.getByRole('button', { name: '수정 적용' }))
    expect(editor.getByRole('alert').textContent).toContain('시간 표현은 원문에 있는 말')
    expect(api.confirmMemo).not.toHaveBeenCalled()
    expect(time.value).toBe('원문에 없는 시간')
    expect(count.value).toBe('2')
    expect(evidence.textContent).toContain(baseEvent.evidence)
  })

  it('응급 키워드 입력 즉시 안내하며 저장·추론 응답을 기다리지 않는다', async () => {
    const user = userEvent.setup()
    render(<RecordPage health={health} />)
    await user.type(
      screen.getByLabelText('어떤 일이 있었나요?'),
      '어머니가 숨을 안 쉬셔서 도움을 요청했어요.',
    )
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain(health.emergency_message)
    expect(alert.textContent).not.toContain('안내가 뜨지 않았다고')
    expect(
      screen.getAllByText('응급 안내가 뜨지 않았다고 괜찮은 상황이라는 뜻은 아니에요.'),
    ).toHaveLength(1)
    expect(alert.nextElementSibling).toBe(
      screen.getByText('응급 안내가 뜨지 않았다고 괜찮은 상황이라는 뜻은 아니에요.'),
    )
    expect(api.createMemo).not.toHaveBeenCalled()
    expect(api.confirmMemo).not.toHaveBeenCalled()
  })

  it('응급 키워드가 없어도 입력·확인·확정 화면에 미탐지 안내를 한 번씩 유지한다', async () => {
    const user = userEvent.setup()
    render(<RecordPage health={health} />)
    const hint = '응급 안내가 뜨지 않았다고 괜찮은 상황이라는 뜻은 아니에요.'
    expect(screen.getAllByText(hint)).toHaveLength(1)
    expect(screen.queryByRole('alert')).toBeNull()
    await enterMemo(user)
    await screen.findByRole('heading', { name: /^정리된 내용 \d+건$/ })
    expect(screen.getAllByText(hint)).toHaveLength(1)
    expect(screen.queryByRole('alert')).toBeNull()
    await user.click(screen.getByRole('button', { name: '확인 완료' }))
    await savedRecord(user)
    expect(screen.getAllByText(hint)).toHaveLength(1)
  })
})

describe('일정: 진료·약 변경·질문 계약', () => {
  it('받은 진료를 선택한 기본 양식에서 지난 날짜를 완료 진료로 저장한다', async () => {
    const user = userEvent.setup()
    await renderSchedule()
    await openVisitForm(user)
    fireEvent.change(screen.getByLabelText('진료받은 날'), { target: { value: '2026-08-20' } })
    await user.click(screen.getByRole('button', { name: '받은 진료 등록', exact: true }))
    await waitFor(() =>
      expect(api.addVisit).toHaveBeenCalledExactlyOnceWith({
        visit_date: '2026-08-20',
        status: '완료',
      }),
    )
    expect(await screen.findByRole('region', { name: '최근 받은 진료' })).toBeTruthy()
  })

  it('예정 날짜가 지나도 완료로 추정하지 않고 명시적으로 완료·취소한다', async () => {
    const user = userEvent.setup()
    visitStore = [{ id: 7, visit_date: '2026-08-20', status: '예정' }]
    await renderSchedule()
    expect(screen.getByRole('region', { name: '진료받으셨나요?' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '2026년 8월 20일 진료 완료' }))
    expect(api.updateVisit).not.toHaveBeenCalled()
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '취소' }))
    expect(api.updateVisit).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '2026년 8월 20일 진료 완료' }))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: '진료 완료' }),
    )
    await waitFor(() =>
      expect(api.updateVisit).toHaveBeenCalledExactlyOnceWith(7, { status: '완료' }),
    )
    await screen.findByRole('region', { name: '최근 받은 진료' })
  })

  it('다음 예약을 선택한 후 미래 날짜를 등록하면 예정 상태로 저장한다', async () => {
    const user = userEvent.setup()
    await renderSchedule()
    await openVisitForm(user)
    await user.click(screen.getByRole('radio', { name: '다음 예약' }))
    fireEvent.change(screen.getByLabelText('다음 예약일', { selector: 'input' }), {
      target: { value: tomorrow() },
    })
    await user.click(screen.getByRole('button', { name: '다음 예약 등록', exact: true }))
    await waitFor(() =>
      expect(api.addVisit).toHaveBeenCalledExactlyOnceWith({
        visit_date: tomorrow(),
        status: '예정',
      }),
    )
  })

  it('진료일·약·선택 질문을 서로 다른 API로 저장하고 변경 이벤트를 발행한다', async () => {
    const user = userEvent.setup()
    const published = vi.fn()
    window.addEventListener('itda-final-updated', published)
    try {
      await renderSchedule()
      await openVisitForm(user)
      fireEvent.change(screen.getByLabelText('진료받은 날', { selector: 'input' }), {
        target: { value: '2026-08-20' },
      })
      await user.click(screen.getByRole('button', { name: '받은 진료 등록', exact: true }))
      await waitFor(() =>
        expect(api.addVisit).toHaveBeenCalledExactlyOnceWith({
          visit_date: '2026-08-20',
          status: '완료',
        }),
      )
      await openMedicationForm(user)
      await user.type(screen.getByLabelText('약 이름'), '  처방약 A  ')
      await user.click(screen.getByRole('radio', { name: '용량 늘림' }))
      fireEvent.change(screen.getByLabelText('바뀐 날'), { target: { value: '2026-09-10' } })
      await user.click(screen.getByRole('button', { name: '변경 내용 저장' }))
      await waitFor(() =>
        expect(api.addMedication).toHaveBeenCalledExactlyOnceWith({
          name: '처방약 A',
          change_type: '증량',
          change_date: '2026-09-10',
        }),
      )
      await openQuestionForm(user)
      const question =
        '약 변경일 뒤에 적은 메모를 함께 봐 주세요.\n밤에 깨는 날을 어떻게 기록할까요?'
      await user.type(
        screen.getByLabelText('다음 진료 때 묻고 싶은 것', { selector: 'textarea' }),
        question,
      )
      await user.click(screen.getByRole('button', { name: '질문 저장' }))
      await screen.findByText(question, { exact: true, normalizer: (value) => value })
      expect(api.addQuestion).toHaveBeenCalledExactlyOnceWith({ text: question })
      expect(published).toHaveBeenCalledTimes(3)
      expect(
        (screen.getByLabelText('다음 진료 때 묻고 싶은 것') as HTMLTextAreaElement).value,
      ).toBe('')
    } finally {
      window.removeEventListener('itda-final-updated', published)
    }
  })

  it('긴 질문을 1000자까지 입력받아 내용과 줄바꿈을 그대로 저장한다', async () => {
    const user = userEvent.setup()
    await renderSchedule()
    await openQuestionForm(user)
    const question = '밤에 깨는 날의 기록을 함께 봐 주세요.\n'.repeat(60)
    const input = screen.getByLabelText('다음 진료 때 묻고 싶은 것', {
      selector: 'textarea',
    }) as HTMLTextAreaElement
    await user.click(input)
    await user.paste(question)
    expect(input.value).toBe(question.slice(0, 1000))
    expect(input.value.length).toBe(1000)
    await user.click(screen.getByRole('button', { name: '질문 저장' }))
    await waitFor(() =>
      expect(api.addQuestion).toHaveBeenCalledExactlyOnceWith({
        text: question.slice(0, 1000).trim(),
      }),
    )
  })

  it('진료일 중복과 약 변경 미래 날짜는 저장하지 않는다', async () => {
    const user = userEvent.setup()
    visitStore = [{ id: 7, visit_date: '2026-08-20', status: '완료' }]
    await renderSchedule()
    await openVisitForm(user)
    fireEvent.change(screen.getByLabelText('진료받은 날', { selector: 'input' }), {
      target: { value: '2026-08-20' },
    })
    await user.click(screen.getByRole('button', { name: '받은 진료 등록', exact: true }))
    expect((await screen.findByRole('alertdialog')).textContent).toContain('이미 등록된 진료일')
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '확인' }))
    expect(api.addVisit).not.toHaveBeenCalled()
    await openMedicationForm(user)
    await user.type(screen.getByLabelText('약 이름'), '처방약')
    await user.click(screen.getByRole('radio', { name: '복용 시작' }))
    const date = screen.getByLabelText('바뀐 날') as HTMLInputElement
    fireEvent.change(date, { target: { value: tomorrow() } })
    await user.click(screen.getByRole('button', { name: '변경 내용 저장' }))
    expect(date.validity.rangeOverflow).toBe(true)
    expect(api.addMedication).not.toHaveBeenCalled()
  })

  it('질문 저장 실패 시 원문을 남기며 재시도 후에만 입력을 비운다', async () => {
    const user = userEvent.setup()
    api.addQuestion.mockRejectedValueOnce(new Error('PC에 연결하지 못했어요.'))
    await renderSchedule()
    await openQuestionForm(user)
    const input = screen.getByLabelText('다음 진료 때 묻고 싶은 것', {
      selector: 'textarea',
    }) as HTMLTextAreaElement
    await user.type(input, '저녁에 불안해한 기록을 함께 봐 주세요.')
    await user.click(screen.getByRole('button', { name: '질문 저장' }))
    expect((await screen.findByRole('alertdialog')).textContent).toContain('PC에 연결하지 못했어요')
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '확인' }))
    expect(input.value).toBe('저녁에 불안해한 기록을 함께 봐 주세요.')
    await user.click(screen.getByRole('button', { name: '질문 저장' }))
    await waitFor(() =>
      expect(
        (screen.getByLabelText('다음 진료 때 묻고 싶은 것') as HTMLTextAreaElement).value,
      ).toBe(''),
    )
    expect(api.addQuestion).toHaveBeenCalledTimes(2)
    expect(api.addQuestion.mock.calls[0]).toEqual(api.addQuestion.mock.calls[1])
  })

  it('삭제를 취소하면 API를 부르지 않고 확인 후에만 목록에서 제거한다', async () => {
    const user = userEvent.setup()
    medicationStore = [{ id: 8, name: '처방약 A', change_type: '시작', change_date: '2026-09-10' }]
    await renderSchedule()
    await openMedicationForm(user)
    const manageLabel = '2026년 9월 10일 처방약 A 복용 시작 관리'
    await user.click(screen.getByRole('button', { name: manageLabel }))
    await user.click(
      within(screen.getByRole('dialog', { name: '약 변경 기록 관리' })).getByRole('button', {
        name: '기록 삭제',
      }),
    )
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '취소' }))
    expect(api.deleteMedication).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: manageLabel })).toBeTruthy()
    await user.click(
      within(screen.getByRole('dialog', { name: '약 변경 기록 관리' })).getByRole('button', {
        name: '기록 삭제',
      }),
    )
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: '삭제하기' }),
    )
    await waitFor(() => expect(screen.queryByRole('button', { name: manageLabel })).toBeNull())
    expect(screen.queryByRole('dialog', { name: '약 변경 기록 관리' })).toBeNull()
    expect(api.deleteMedication).toHaveBeenCalledExactlyOnceWith(8)
  })
})

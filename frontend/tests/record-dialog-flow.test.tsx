import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecordPage } from '../src/features/records/RecordPage'
import { localToday } from '../src/shared/lib/date'
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
  workspace_id: 'dialog-flow',
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
  memo_id: 50,
  record_date: '2026-09-27',
  text: event.evidence,
  status: '확인 대기',
  events: [event],
  emergency: { matched: false, message: null },
}
let records: MemoResult[]
beforeEach(() => {
  vi.resetAllMocks()
  api.questions.mockResolvedValue([])
  window.history.replaceState(null, '', '#record?as_of=2026-09-27&period_start=2026-08-20&memo=50')
  records = [memo]
  api.memos.mockImplementation(async () => records)
  api.memoRevisions.mockResolvedValue([])
  api.deleteMemo.mockImplementation(async (id: number) => {
    records = records.filter((item) => item.memo_id !== id)
  })
  api.confirmMemo.mockImplementation(async (_id, body) => {
    const saved = { ...records[0], status: '확인 완료', events: body.events } as MemoResult
    records = [saved]
    return saved
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  window.history.replaceState(null, '', '#record')
})
const dialog = () => within(screen.getByRole('dialog', { name: '내용 수정' }))
async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: '1번 야간 각성 수정' }))
  return dialog()
}
async function closeSuccess(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    within(await screen.findByRole('dialog', { name: '완료했어요' })).getByRole('button', {
      name: '확인',
    }),
  )
}

async function renderComposed(user: ReturnType<typeof userEvent.setup>) {
  window.history.replaceState(null, '', '#record?as_of=2026-09-27&period_start=2026-08-20')
  api.createMemo.mockResolvedValue(memo)
  const mounted = render(<RecordPage health={health} />)
  await user.type(screen.getByLabelText('어떤 일이 있었나요?'), memo.text)
  await user.click(screen.getByRole('button', { name: '저장하고 정리하기' }))
  await screen.findByRole('heading', { name: '작성한 메모' })
  return mounted
}
async function reopenRecent(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    within(screen.getByRole('region', { name: '최근 기록' })).getByRole('button', {
      name: /새벽에 두 번/,
    }),
  )
}

it('수정 창은 임시 입력을 취소하면 버리고 적용할 때만 카드에 반영한다', async () => {
  const user = userEvent.setup()
  render(<RecordPage health={health} />)
  let editor = await openEditor(user)
  fireEvent.change(editor.getByLabelText(/^횟수/), { target: { value: '9' } })
  await user.click(editor.getByRole('button', { name: '취소' }))
  expect(
    within(screen.getByRole('region', { name: '1번 야간 각성' })).getByText('2회'),
  ).toBeTruthy()
  editor = await openEditor(user)
  expect((editor.getByLabelText(/^횟수/) as HTMLInputElement).value).toBe('2')
  fireEvent.change(editor.getByLabelText(/^횟수/), { target: { value: '4' } })
  await user.click(editor.getByRole('button', { name: '수정 적용' }))
  expect(screen.queryByRole('dialog', { name: '내용 수정' })).toBeNull()
  expect(screen.getByRole('dialog', { name: '정리된 내용', exact: true })).toBeTruthy()
  expect(
    within(screen.getByRole('region', { name: '1번 야간 각성' })).getByText('4회'),
  ).toBeTruthy()
  await user.click(screen.getByRole('button', { name: '확인 완료' }))
  expect(api.confirmMemo).toHaveBeenCalledExactlyOnceWith(50, { events: [{ ...event, count: 4 }] })
})

it('근거를 원문에서 다시 선택해 확인하면 출처 번호는 유지하고 원문에 없는 시간은 적용하지 않는다', async () => {
  const user = userEvent.setup()
  render(<RecordPage health={health} />)
  const editor = await openEditor(user)
  const source = editor.getByRole('textbox', {
    name: '원문에서 근거 선택',
  }) as HTMLTextAreaElement
  expect(source.readOnly).toBe(true)
  expect(source.value).toBe(memo.text)
  const evidence = editor.getByRole('region', { name: '선택한 근거' })
  expect(evidence.textContent).toContain(event.evidence)
  expect(evidence.querySelector('input, textarea, [contenteditable="true"]')).toBeNull()
  expect(editor.queryByLabelText(/^근거 구절/)).toBeNull()
  const selectedEvidence = '두 번 깨셨어요.'
  const start = source.value.indexOf(selectedEvidence)
  source.focus()
  source.setSelectionRange(start, start + selectedEvidence.length)
  fireEvent.select(source)
  expect(within(evidence).getByText(selectedEvidence)).toBeTruthy()
  const time = editor.getByLabelText(/^원문 시간 표현/) as HTMLInputElement
  fireEvent.change(time, { target: { value: '메모에 없는 시간' } })
  await user.click(editor.getByRole('button', { name: '수정 적용' }))
  expect(editor.getByRole('alert').textContent).toContain('시간 표현은 원문에 있는 말')
  expect(time.value).toBe('메모에 없는 시간')
  expect(within(evidence).getByText(selectedEvidence)).toBeTruthy()
  expect(api.confirmMemo).not.toHaveBeenCalled()
  fireEvent.change(time, { target: { value: '새벽' } })
  await user.click(editor.getByRole('button', { name: '수정 적용' }))
  expect(screen.getByLabelText('근거 원문').querySelector('mark')?.textContent).toBe(
    selectedEvidence,
  )
  expect(
    screen.getByRole('heading', { name: '작성한 메모' }).closest('section')?.textContent,
  ).toContain(memo.text)
  await user.click(screen.getByRole('button', { name: '확인 완료' }))
  expect(api.confirmMemo).toHaveBeenCalledExactlyOnceWith(50, {
    events: [{ ...event, evidence: selectedEvidence, model_event_index: 0 }],
  })
})

it('두 카드 중 하나의 유형을 바꿔도 다른 카드의 유형·횟수·근거와 두 출처 번호는 유지한다', async () => {
  const second: EventCard = {
    type: '불안',
    status: '있었음',
    time_expr: '낮에',
    count: 1,
    evidence: '낮에 걱정된다고 하셨어요.',
    model_event_index: 1,
  }
  records = [{ ...memo, text: `${memo.text} ${second.evidence}`, events: [event, second] }]
  const user = userEvent.setup()
  render(<RecordPage health={health} />)
  await user.click(await screen.findByRole('button', { name: '2번 불안 수정' }))
  const editor = dialog()
  await user.selectOptions(editor.getByLabelText('유형'), '초조·공격')
  expect(editor.getByRole('region', { name: '선택한 근거' }).textContent).toContain(second.evidence)
  await user.click(editor.getByRole('button', { name: '수정 적용' }))
  const unchanged = within(screen.getByRole('region', { name: '1번 야간 각성' }))
  expect(unchanged.getByRole('heading', { name: '야간 각성', exact: true })).toBeTruthy()
  expect(unchanged.getByText('2회')).toBeTruthy()
  expect(unchanged.getByLabelText('근거 원문').textContent).toContain(event.evidence)
  const changed = within(screen.getByRole('region', { name: '2번 초조·공격' }))
  expect(changed.getByRole('heading', { name: '초조·공격', exact: true })).toBeTruthy()
  expect(changed.getByText('1회')).toBeTruthy()
  expect(changed.getByLabelText('근거 원문').textContent).toContain(second.evidence)
  await user.click(screen.getByRole('button', { name: '확인 완료' }))
  expect(api.confirmMemo).toHaveBeenCalledExactlyOnceWith(50, {
    events: [event, { ...second, type: '초조·공격' }],
  })
})

it('빠진 사건은 원문 구절을 선택해야 추가되며 유형을 바꿔도 선택 근거와 기존 사건을 유지한다', async () => {
  const selectedEvidence = '낮에 걱정된다고 하셨어요.'
  const fullText = `${memo.text}\n${selectedEvidence}\n식사는 잘 드셨어요.`
  records = [{ ...memo, text: fullText }]
  const user = userEvent.setup()
  render(<RecordPage health={health} />)
  await user.click(await screen.findByRole('button', { name: '빠진 사건 추가' }))
  const manual = within(screen.getByRole('dialog', { name: '빠진 사건 추가' }))
  const source = manual.getByRole('textbox', { name: '원문에서 근거 선택' }) as HTMLTextAreaElement
  expect(source.readOnly).toBe(true)
  expect(source.value).toBe(fullText)
  expect(manual.queryByLabelText(/^근거 구절/)).toBeNull()

  await user.click(manual.getByRole('button', { name: '사건 추가' }))
  expect(manual.getByRole('alert').textContent).toContain(
    '원문에서 사건이 나온 구절을 선택해 주세요.',
  )
  expect(api.addEvent).not.toHaveBeenCalled()
  expect(api.confirmMemo).not.toHaveBeenCalled()
  expect(screen.queryByRole('region', { name: '2번 야간 각성' })).toBeNull()

  await user.type(source, '원문에 없는 내용')
  expect(source.value).toBe(fullText)
  source.focus()
  const start = fullText.indexOf(selectedEvidence)
  source.setSelectionRange(start, start + selectedEvidence.length)
  fireEvent.select(source)
  expect(
    within(manual.getByRole('region', { name: '선택한 근거' })).getByText(selectedEvidence),
  ).toBeTruthy()
  await user.selectOptions(manual.getByLabelText('유형'), '불안')
  expect(
    within(manual.getByRole('region', { name: '선택한 근거' })).getByText(selectedEvidence),
  ).toBeTruthy()
  fireEvent.change(manual.getByLabelText(/^횟수/), { target: { value: '3' } })
  fireEvent.change(manual.getByLabelText(/^원문 시간 표현/), { target: { value: '낮에' } })
  await user.click(manual.getByRole('button', { name: '사건 추가' }))

  expect(screen.queryByRole('dialog', { name: '빠진 사건 추가' })).toBeNull()
  expect(screen.getByRole('region', { name: '1번 야간 각성' }).textContent).toContain('2회')
  const added = within(screen.getByRole('region', { name: '2번 불안' }))
  expect(added.getByText('3회')).toBeTruthy()
  expect(added.getByLabelText('근거 원문').textContent).toContain(selectedEvidence)
  expect(api.addEvent).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '확인 완료' }))
  expect(api.confirmMemo).toHaveBeenCalledExactlyOnceWith(50, {
    events: [
      event,
      {
        type: '불안',
        status: '있었음',
        count: 3,
        time_expr: '낮에',
        evidence: selectedEvidence,
        model_event_index: null,
      },
    ],
  })
})

it('정리 팝업을 닫거나 Esc로 접어도 적용한 미확정 수정을 유지하고 다시 열어 저장한다', async () => {
  const user = userEvent.setup()
  await renderComposed(user)
  const editor = await openEditor(user)
  fireEvent.change(editor.getByLabelText(/^횟수/), { target: { value: '4' } })
  await user.click(editor.getByRole('button', { name: '수정 적용' }))

  let resultDialog = screen.getByRole('dialog', { name: '정리된 내용', exact: true })
  expect(within(resultDialog).getByText('4회')).toBeTruthy()
  await user.click(within(resultDialog).getByRole('button', { name: '닫기', exact: true }))
  expect(screen.queryByRole('dialog', { name: '정리된 내용', exact: true })).toBeNull()
  expect((screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement).value).toBe(
    memo.text,
  )
  expect(api.confirmMemo).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: '정리된 내용 보기' }))
  resultDialog = screen.getByRole('dialog', { name: '정리된 내용', exact: true })
  expect(within(resultDialog).getByText('4회')).toBeTruthy()
  fireEvent(resultDialog, new Event('cancel', { cancelable: true }))
  expect(screen.queryByRole('dialog', { name: '정리된 내용', exact: true })).toBeNull()

  await user.click(
    within(screen.getByRole('region', { name: '최근 기록' })).getByRole('button', {
      name: /확인 대기/,
    }),
  )
  expect(screen.queryByRole('alertdialog')).toBeNull()
  resultDialog = screen.getByRole('dialog', { name: '정리된 내용', exact: true })
  expect(within(resultDialog).getByText('4회')).toBeTruthy()
  await user.click(within(resultDialog).getByRole('button', { name: '확인 완료' }))
  expect(api.confirmMemo).toHaveBeenCalledExactlyOnceWith(50, { events: [{ ...event, count: 4 }] })
  await closeSuccess(user)
  expect(screen.queryByRole('dialog', { name: '정리된 내용', exact: true })).toBeNull()
  expect(screen.queryByRole('button', { name: '정리된 내용 보기' })).toBeNull()
  expect((screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement).value).toBe('')
})

it('확인 완료한 지난 기록은 팝업에서 닫고 다시 열어도 재분석이나 저장을 하지 않는다', async () => {
  records = [{ ...memo, status: '확인 완료' }]
  const user = userEvent.setup()
  render(<RecordPage health={health} />)
  let resultDialog = await screen.findByRole('dialog', { name: '정리된 내용', exact: true })
  expect(within(resultDialog).getByRole('heading', { name: '확인 완료한 내용' })).toBeTruthy()
  await user.click(within(resultDialog).getByRole('button', { name: '닫기', exact: true }))

  await reopenRecent(user)
  resultDialog = screen.getByRole('dialog', { name: '정리된 내용', exact: true })
  expect(
    within(resultDialog).getByRole('region', { name: '확인 완료한 사건' }).textContent,
  ).toContain('새벽 · 2회')
  expect(within(resultDialog).getByRole('heading', { name: '작성한 메모' })).toBeTruthy()
  expect(api.createMemo).not.toHaveBeenCalled()
  expect(api.retryMemo).not.toHaveBeenCalled()
  expect(api.confirmMemo).not.toHaveBeenCalled()
})

it('접어 둔 미확정 기록을 새 메모로 바꿀 때 취소하면 보존하고 승인하면 팝업 상태도 비운다', async () => {
  const user = userEvent.setup()
  await renderComposed(user)
  const resultDialog = await screen.findByRole('dialog', { name: '정리된 내용', exact: true })
  await user.click(within(resultDialog).getByRole('button', { name: '닫기', exact: true }))
  await user.click(screen.getByRole('button', { name: '새 메모 쓰기' }))
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '취소' }))
  expect((screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement).value).toBe(
    memo.text,
  )
  expect(screen.getByRole('button', { name: '정리된 내용 보기' })).toBeTruthy()

  await user.click(screen.getByRole('button', { name: '새 메모 쓰기' }))
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: '새 메모 쓰기' }),
  )
  await waitFor(() =>
    expect((screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement).value).toBe(''),
  )
  expect(screen.queryByRole('dialog', { name: '정리된 내용', exact: true })).toBeNull()
  expect(screen.queryByRole('button', { name: '정리된 내용 보기' })).toBeNull()
  expect(api.confirmMemo).not.toHaveBeenCalled()
})

it('카드 삭제는 중앙 확인창에서 취소하거나 승인하며 원문을 유지한다', async () => {
  const user = userEvent.setup()
  render(<RecordPage health={health} />)
  const remove = await screen.findByRole('button', { name: '1번 야간 각성 카드 삭제' })
  await user.click(remove)
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '취소' }))
  expect(screen.getByRole('region', { name: '1번 야간 각성' })).toBeTruthy()
  await user.click(remove)
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: '카드 삭제' }),
  )
  expect(screen.queryByRole('region', { name: '1번 야간 각성' })).toBeNull()
  expect(
    screen.getByRole('heading', { name: '작성한 메모' }).closest('section')?.textContent,
  ).toContain(memo.text)
  expect((screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement).value).toBe('')
  expect(api.confirmMemo).not.toHaveBeenCalled()
})

it.each(['확인 대기', '확인 완료', '정리 실패'] as const)(
  '%s 저장 완료는 오늘의 빈 화면으로 돌아와 질문 초안과 조회 기간을 보존한다',
  async (status) => {
    records = [{ ...memo, status, events: status === '정리 실패' ? [] : memo.events }]
    const user = userEvent.setup()
    render(<RecordPage health={health} />)
    await screen.findByRole('heading', { name: '작성한 메모' })
    await user.type(screen.getByLabelText('질문 메모'), '진료 때 이어 쓸 질문')
    if (status === '확인 완료') {
      await user.click(screen.getByRole('button', { name: '확정 내용 수정' }))
      await user.click(screen.getByRole('button', { name: '변경 내용 검토' }))
      await user.click(
        within(screen.getByRole('dialog', { name: '변경 내용 검토' })).getByRole('button', {
          name: '다시 확정',
        }),
      )
    } else if (status === '정리 실패') {
      await user.click(screen.getByRole('button', { name: '직접 정리' }))
      await user.click(screen.getByRole('button', { name: '확인 완료' }))
    } else await user.click(screen.getByRole('button', { name: '확인 완료' }))
    await closeSuccess(user)
    expect(screen.getByRole('heading', { level: 1, name: '오늘 하루는 어떠셨나요?' })).toBeTruthy()
    expect((screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement).value).toBe('')
    expect((screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement).disabled).toBe(
      false,
    )
    expect((screen.getByLabelText('기록 날짜') as HTMLInputElement).value).toBe(localToday())
    expect((screen.getByLabelText('질문 메모') as HTMLTextAreaElement).value).toBe(
      '진료 때 이어 쓸 질문',
    )
    expect(location.hash).toBe('#record?as_of=2026-09-27&period_start=2026-08-20')
    expect(
      within(screen.getByRole('region', { name: '최근 기록' })).getByRole('button', {
        name: /확인 완료/,
      }),
    ).toBeTruthy()
    if (status === '정리 실패')
      expect(api.confirmMemo).toHaveBeenCalledWith(50, { manual: true, events: [] })
  },
)

it('저장 실패는 적용한 카드와 질문 초안을 남기고 중복 요청 없이 재시도한다', async () => {
  let reject!: (error: Error) => void
  api.confirmMemo.mockImplementationOnce(
    () =>
      new Promise((_resolve, failure) => {
        reject = failure
      }),
  )
  const user = userEvent.setup()
  render(<RecordPage health={health} />)
  const editor = await openEditor(user)
  fireEvent.change(editor.getByLabelText(/^횟수/), { target: { value: '4' } })
  await user.click(editor.getByRole('button', { name: '수정 적용' }))
  await user.type(screen.getByLabelText('질문 메모'), '질문 초안')
  const save = screen.getByRole('button', { name: '확인 완료' })
  fireEvent.submit(save.closest('form')!)
  fireEvent.submit(save.closest('form')!)
  expect(api.confirmMemo).toHaveBeenCalledTimes(1)
  await act(async () => reject(new Error('저장 연결 실패')))
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', { name: '확인' }),
  )
  expect(
    within(screen.getByRole('region', { name: '1번 야간 각성' })).getByText('4회'),
  ).toBeTruthy()
  expect((screen.getByLabelText('질문 메모') as HTMLTextAreaElement).value).toBe('질문 초안')
  await user.click(screen.getByRole('button', { name: '확인 완료' }))
  expect(api.confirmMemo.mock.calls[1]).toEqual(api.confirmMemo.mock.calls[0])
})

it('숨겨진 기록 화면은 확인창을 닫고 비동기 저장 알림도 표시하지 않는다', async () => {
  const user = userEvent.setup()
  const mounted = await renderComposed(user)
  await user.click(await screen.findByRole('button', { name: '새 메모 쓰기' }))
  expect(screen.getByRole('alertdialog')).toBeTruthy()
  mounted.rerender(<RecordPage health={health} active={false} />)
  expect(screen.queryByRole('alertdialog')).toBeNull()
  mounted.rerender(<RecordPage health={health} />)
  expect((screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement).value).toBe(
    memo.text,
  )
  let finish!: (memo: MemoResult) => void
  api.confirmMemo.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  await user.click(screen.getByRole('button', { name: '확인 완료' }))
  mounted.rerender(<RecordPage health={health} active={false} />)
  await act(async () => finish({ ...memo, status: '확인 완료' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  mounted.rerender(<RecordPage health={health} />)
  expect(screen.getByRole('dialog', { name: '완료했어요' })).toBeTruthy()
})

it('새 메모 전환을 취소하면 내용이 남고 승인하면 질문을 제외한 기록만 비운다', async () => {
  const user = userEvent.setup()
  await renderComposed(user)
  await screen.findByRole('heading', { name: '작성한 메모' })
  await user.type(screen.getByLabelText('질문 메모'), '이어 쓸 질문')
  await user.click(screen.getByRole('button', { name: '새 메모 쓰기' }))
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '취소' }))
  expect((screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement).value).toBe(
    memo.text,
  )
  await user.click(screen.getByRole('button', { name: '새 메모 쓰기' }))
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: '새 메모 쓰기' }),
  )
  await waitFor(() =>
    expect((screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement).value).toBe(''),
  )
  expect((screen.getByLabelText('질문 메모') as HTMLTextAreaElement).value).toBe('이어 쓸 질문')
})

it.each(['확인 대기', '확인 완료', '정리 실패'] as const)(
  '%s 메모는 삭제 취소 시 유지하고 승인 시 원문과 상세를 닫고 오늘의 기록으로 돌아간다',
  async (status) => {
    records = [{ ...memo, status }]
    const user = userEvent.setup()
    const onUpdated = vi.fn()
    window.addEventListener('itda-final-updated', onUpdated)
    try {
      render(<RecordPage health={health} />)
      const review = within(await screen.findByRole('dialog', { name: '정리된 내용', exact: true }))
      await user.click(review.getByRole('button', { name: '기록 삭제', exact: true }))
      let confirm = within(screen.getByRole('alertdialog', { name: '이 기록을 삭제할까요?' }))
      expect(confirm.getByText(/경과와 요약지에서도 제외/)).toBeTruthy()
      await user.click(confirm.getByRole('button', { name: '취소' }))
      expect(api.deleteMemo).not.toHaveBeenCalled()
      expect(review.getByText(memo.text, { selector: 'p' })).toBeTruthy()
      await user.click(review.getByRole('button', { name: '기록 삭제', exact: true }))
      confirm = within(screen.getByRole('alertdialog', { name: '이 기록을 삭제할까요?' }))
      await user.click(confirm.getByRole('button', { name: '기록 삭제', exact: true }))
      await screen.findByText('기록을 삭제했어요.')
      expect(api.deleteMemo).toHaveBeenCalledExactlyOnceWith(memo.memo_id)
      expect(onUpdated).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('dialog', { name: '정리된 내용', exact: true })).toBeNull()
      expect(
        screen.getByRole('heading', { name: '오늘 하루는 어떠셨나요?', level: 1 }),
      ).toBeTruthy()
      expect((screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement).value).toBe('')
      expect(window.location.hash).not.toContain('memo=')
      await closeSuccess(user)
      await user.click(screen.getByRole('button', { name: '지난 기록 찾기' }))
      expect(
        within(screen.getByRole('complementary')).queryByRole('button', { name: /^기록 삭제:/ }),
      ).toBeNull()
    } finally {
      window.removeEventListener('itda-final-updated', onUpdated)
    }
  },
)

it('상세에서 삭제 실패 시 메모가 남고 재시도 후에도 작성 중 질문을 보존한다', async () => {
  api.deleteMemo.mockRejectedValueOnce(new Error('서버에 연결하지 못했어요.'))
  const user = userEvent.setup()
  render(<RecordPage health={health} />)
  let review = within(await screen.findByRole('dialog', { name: '정리된 내용', exact: true }))
  await user.click(review.getByRole('button', { name: '닫기' }))
  await user.type(screen.getByLabelText('질문 메모'), '아직 작성 중인 질문')
  await reopenRecent(user)
  review = within(screen.getByRole('dialog', { name: '정리된 내용', exact: true }))
  await user.click(review.getByRole('button', { name: '기록 삭제', exact: true }))
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: '기록 삭제', exact: true }),
  )
  const failure = within(await screen.findByRole('alertdialog', { name: '다시 확인해 주세요' }))
  expect(failure.getByText(/기록을 삭제하지 못했어요/)).toBeTruthy()
  await user.click(failure.getByRole('button', { name: '확인' }))
  expect(review.getByText(memo.text, { selector: 'p' })).toBeTruthy()
  await user.click(review.getByRole('button', { name: '기록 삭제', exact: true }))
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: '기록 삭제', exact: true }),
  )
  await closeSuccess(user)
  expect(screen.queryByRole('dialog', { name: '정리된 내용', exact: true })).toBeNull()
  expect(screen.getByRole('heading', { name: '오늘 하루는 어떠셨나요?', level: 1 })).toBeTruthy()
  expect((screen.getByLabelText('질문 메모') as HTMLTextAreaElement).value).toBe(
    '아직 작성 중인 질문',
  )
  await user.click(screen.getByRole('button', { name: '지난 기록 찾기' }))
  expect(
    within(screen.getByRole('complementary')).queryByRole('button', { name: /2026년 9월 27일/ }),
  ).toBeNull()
  expect(api.createMemo).not.toHaveBeenCalled()
})

it('보고서에서 지난 기록으로 바로 연결하면 해당 기간 목록을 열고 삭제는 상세에서만 제공한다', async () => {
  records = [memo, { ...memo, memo_id: 40, record_date: '2026-08-05', text: '지난달 관찰 메모' }]
  window.history.replaceState(
    null,
    '',
    '#record?view=history&from=2026-08-01&to=2026-08-31&as_of=2026-08-31&period_start=2026-08-01',
  )
  const user = userEvent.setup()
  render(<RecordPage health={health} />)
  expect(screen.getByRole('heading', { name: '지난 기록 찾기', level: 1 })).toBeTruthy()
  const history = within(screen.getByRole('complementary', { name: '최근 기록' }))
  expect((history.getByLabelText('시작일') as HTMLInputElement).value).toBe('2026-08-01')
  expect((history.getByLabelText('종료일') as HTMLInputElement).value).toBe('2026-08-31')
  const entry = await history.findByRole('button', { name: /지난달 관찰 메모/ })
  expect(history.queryByRole('button', { name: /삭제/ })).toBeNull()
  expect(history.queryByRole('button', { name: /2026년 9월 27일/ })).toBeNull()
  expect(screen.queryByRole('dialog')).toBeNull()
  await user.click(entry)
  const review = within(await screen.findByRole('dialog', { name: '정리된 내용', exact: true }))
  expect(review.getByRole('button', { name: '기록 삭제', exact: true })).toBeTruthy()
  expect(window.location.hash).toContain('memo=40')
  expect(window.location.hash).toContain('view=history')
  expect(window.location.hash).toContain('period_start=2026-08-01')
  await user.click(review.getByRole('button', { name: '닫기' }))
  expect(screen.getByRole('heading', { level: 1, name: '지난 기록 찾기' })).toBeTruthy()
  expect(history.getByRole('button', { name: /지난달 관찰 메모/ })).toBeTruthy()
  expect((history.getByLabelText('시작일') as HTMLInputElement).value).toBe('2026-08-01')
  expect(window.location.hash).not.toContain('memo=')
  await user.click(screen.getByRole('button', { name: '기록하기' }))
  expect((screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement).value).toBe('')
  expect((screen.getByLabelText('기록 날짜') as HTMLInputElement).value).toBe(localToday())
})

it.each(['기록하기', '기록 메뉴'])(
  '지난 기록 링크를 따라온 뒤 %s로 돌아가도 관찰 초안을 지우지 않는다',
  async (returnPath) => {
    window.history.replaceState(null, '', '#record')
    const user = userEvent.setup()
    render(<RecordPage health={health} />)
    await user.type(screen.getByLabelText('어떤 일이 있었나요?'), '작성 중인 관찰 메모')
    act(() => {
      window.history.replaceState(null, '', '#record?view=history&from=2026-09-01&to=2026-09-27')
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(screen.getByRole('heading', { name: '지난 기록 찾기', level: 1 })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    if (returnPath === '기록하기') {
      await user.click(screen.getByRole('button', { name: '기록하기' }))
    } else {
      act(() => {
        window.history.replaceState(null, '', '#record')
        window.dispatchEvent(new HashChangeEvent('hashchange'))
      })
    }
    expect(screen.getByRole('heading', { name: '오늘 하루는 어떠셨나요?', level: 1 })).toBeTruthy()
    expect((screen.getByLabelText('어떤 일이 있었나요?') as HTMLTextAreaElement).value).toBe(
      '작성 중인 관찰 메모',
    )
    expect(window.location.hash).not.toContain('view=history')
    expect(api.createMemo).not.toHaveBeenCalled()
  },
)

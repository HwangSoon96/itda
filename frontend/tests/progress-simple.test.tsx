import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProgressPage } from '../src/features/progress/ProgressPage'
import { TrendChart } from '../src/shared/report'
import { EVENT_TYPES } from '../src/api/types'
import type { Health, MemoResult, Summary, Trends } from '../src/api/types'

const api = vi.hoisted(() => ({
  summary: vi.fn(),
  trends: vi.fn(),
  memos: vi.fn(),
  visits: vi.fn(),
}))
vi.mock('../src/api', () => ({ api }))
const chartRender = vi.hoisted(() => ({
  points: [] as Array<{ recorded_days: number; lineRate: number | null; lowRate: number | null }>,
  lines: {} as Record<string, { stroke?: string; dot?: { fill?: string }; connectNulls?: boolean }>,
  references: [] as Array<{
    x: number
    strokeDasharray?: string
    label?: { value?: string; dy?: number }
  }>,
  margin: { top: 0 },
}))
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({
    children,
    data,
    margin,
  }: {
    children: React.ReactNode
    data: typeof chartRender.points
    margin: typeof chartRender.margin
  }) => {
    chartRender.points = data
    chartRender.margin = margin
    return <div>{children}</div>
  },
  Line: (props: {
    dataKey: string
    stroke?: string
    dot?: { fill?: string }
    connectNulls?: boolean
  }) => {
    chartRender.lines[props.dataKey] = props
    return null
  },
  ReferenceLine: (props: (typeof chartRender.references)[number]) => {
    chartRender.references.push(props)
    return null
  },
  ReferenceArea: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}))
const health = {} as Health
let data: Summary
function fixture(): Summary {
  return {
    patient_alias: '가상 대상',
    period: { start: '2026-08-20', end: '2026-09-27' },
    baseline: { start: '2026-05-21', end: '2026-08-19' },
    coverage: { recorded_days: 26, total_days: 39 },
    baseline_coverage: { recorded_days: 80, total_days: 91 },
    exclusions: {
      pending_memo_ids: [],
      failed_memo_ids: [],
    },
    rows: EVENT_TYPES.map((type, index) => ({
      type,
      baseline_rate: 0.1,
      current_rate: type === '야간 각성' ? 0.5 : 0.1,
      weekly_count: 1,
      mark: type === '야간 각성' ? '증가' : type === '환각' ? '새로 나타남' : null,
      occurrence_days: type === '야간 각성' ? 13 : type === '낙상' ? 2 : 3,
      recorded_days: 26,
      baseline_occurrence_days: 7,
      baseline_recorded_days: 80,
      evidence_dates: ['2026-09-24'],
      memo_ids: [index + 1],
    })),
    sentences: [],
    medications: [{ name: '처방약', change_type: '시작', date: '2026-09-10' }],
    falls: ['2026-09-09'],
    questions: [],
    disclaimer: '진단 문구 아님',
  }
}
function chart(type: Trends['type']): Trends {
  return {
    type,
    period: data.period,
    baseline: data.baseline,
    weeks: [
      {
        start: '2026-09-21',
        end: '2026-09-27',
        period: 'current',
        recorded_days: 3,
        event_days: 2,
        rate: null,
        low_coverage: true,
      },
    ],
    medications: [{ name: '처방약', date: '2026-09-10', change_type: '시작' }],
  }
}
beforeEach(() => {
  chartRender.points = []
  chartRender.lines = {}
  chartRender.references = []
  chartRender.margin = { top: 0 }
  vi.resetAllMocks()
  api.visits.mockResolvedValue([
    { id: 1, visit_date: '2026-08-20', status: '완료' },
    { id: 2, visit_date: '2026-09-28', status: '예정' },
  ])
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 27, 12))
  window.history.replaceState(null, '', '#progress?as_of=2026-09-27&period_start=2026-08-20')
  data = fixture()
  api.summary.mockImplementation(async () => data)
  api.trends.mockImplementation(async (type: Trends['type']) => chart(type))
  api.memos.mockResolvedValue([])
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true
    },
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false
    },
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  window.history.replaceState(null, '', '#progress')
})
async function ready() {
  return screen.findByRole('region', { name: '주간 추이' })
}

it('AI를 호출하지 않고 증가·새로 나타남 카드와 별도 낙상, 헤더 기록일을 보여준다', async () => {
  render(<ProgressPage health={health} active />)
  await ready()
  expect(api.summary).toHaveBeenCalledWith('2026-09-27', '2026-08-20', false)
  const featured = screen.getByRole('region', { name: '주요 관찰 기록' })
  expect(within(featured).getAllByRole('button')).toHaveLength(3)
  expect(
    within(featured).getByRole('button', { name: /야간 각성, 기준 10% → 이번 50%, 증가/ })
      .textContent,
  ).toContain('기록일 26일 중 13일')
  expect(
    within(featured).getByRole('button', { name: '낙상 관련 기록 보기' }).textContent,
  ).toContain('9월 9일')
  expect(screen.getByLabelText('기록 커버리지').textContent).toContain('39일 중 26일 기록')
  expect(within(featured).queryByLabelText('기록 커버리지')).toBeNull()
})
it('표시 없는 유형을 임의의 대표 카드로 넣지 않고 낙상만 남긴다', async () => {
  data.rows = data.rows.map((row) => ({ ...row, mark: null }))
  render(<ProgressPage health={health} active />)
  await ready()
  expect(
    within(screen.getByRole('region', { name: '주요 관찰 기록' })).getAllByRole('button'),
  ).toHaveLength(1)
  expect(screen.getByText('증가·새로 나타남 표시가 붙은 항목이 없어요.')).toBeTruthy()
  expect(screen.getByText(/표시가 없다고 이상이 없다는 뜻은 아니에요/)).toBeTruthy()
})
it('첫 그래프는 요약지 top3 첫 유형을 사용하고 모든 유형으로 전환할 수 있다', async () => {
  data.trends = [chart('식사량 감소')]
  const user = userEvent.setup()
  render(<ProgressPage health={health} active />)
  await ready()
  await screen.findByRole('img', { name: /식사량 감소 주간 추이/ })
  const select = screen.getByRole('combobox', { name: '추이 유형' })
  expect(within(select).getAllByRole('option')).toHaveLength(12)
  await user.selectOptions(select, '불안')
  await screen.findByRole('img', { name: /불안 주간 추이/ })
  expect(api.trends).toHaveBeenLastCalledWith('불안', '2026-09-27', '2026-08-20')
  expect(screen.queryByRole('link', { name: '요약지 미리보기' })).toBeNull()
})
it('확인한 기록이 없어도 낙상 없음과 기록 시작 동선, 유형 선택을 유지한다', async () => {
  data.coverage.recorded_days = 0
  data.falls = []
  data.rows = data.rows.map((row) => ({
    ...row,
    mark: '기록 부족',
    occurrence_days: 0,
    recorded_days: 0,
  }))
  render(<ProgressPage health={health} active />)
  await ready()
  expect(screen.getByText('확인한 기록이 아직 없어요.')).toBeTruthy()
  expect(
    (screen.getByRole('button', { name: '낙상 관련 기록 보기' }) as HTMLButtonElement).disabled,
  ).toBe(true)
  expect(screen.getByRole('link', { name: '기록하러 가기' })).toBeTruthy()
  expect(screen.getByRole('combobox', { name: '추이 유형' })).toBeTruthy()
})
it.each(['기록 부족', '비교 불가'] as const)('%s 상태에 증가비교를 만들지 않는다', async (mark) => {
  data.rows = data.rows.map((row) => ({ ...row, mark }))
  if (mark === '비교 불가') data.baseline = null
  else data.coverage.recorded_days = 10
  render(<ProgressPage health={health} active />)
  await ready()
  expect(screen.getByText(mark)).toBeTruthy()
  expect(screen.queryByRole('button', { name: /기준.*→/ })).toBeNull()
})
it('약 변경과 낙상을 독립된 목록으로 보여주고 각각 날짜순으로 유지한다', async () => {
  data.medications = Array.from({ length: 7 }, (_, i) => ({
    name: `약 ${i}`,
    date: `2026-09-${20 - i}`,
    change_type: '시작',
  }))
  data.falls = ['2026-09-23', '2026-09-09']
  const original = structuredClone({ medications: data.medications, falls: data.falls })
  render(<ProgressPage health={health} active />)
  await ready()
  const latestFall = screen.getByRole('button', { name: '낙상 관련 기록 보기' })
  expect(latestFall.querySelector('strong')?.textContent).toBe('9월 23일')
  const medications = screen.getByRole('region', { name: '약 변경' })
  const falls = screen.getByRole('region', { name: '낙상' })
  const dates = Array.from(medications.querySelectorAll('time')).map((el) => el.dateTime)
  expect(dates).toEqual([
    '2026-09-14',
    '2026-09-15',
    '2026-09-16',
    '2026-09-17',
    '2026-09-18',
    '2026-09-19',
    '2026-09-20',
  ])
  expect(within(medications).queryByText('낙상')).toBeNull()
  expect(Array.from(falls.querySelectorAll('time')).map((el) => el.dateTime)).toEqual([
    '2026-09-09',
    '2026-09-23',
  ])
  expect(within(falls).getAllByRole('listitem')).toHaveLength(2)
  expect(within(falls).queryByText(/복용 시작/)).toBeNull()
  expect({ medications: data.medications, falls: data.falls }).toEqual(original)
  const chartRegion = within(screen.getByRole('region', { name: '주간 추이' }))
  expect(chartRegion.getByText(/세로선은 날짜 순서를/)).toBeTruthy()
  expect(screen.getAllByText(/세로선은 날짜 순서를/)).toHaveLength(1)
})
it.each([
  { medications: false, falls: true },
  { medications: true, falls: false },
  { medications: false, falls: false },
])('약 변경과 낙상의 빈 상태를 각각 표시한다: %j', async (present) => {
  if (!present.medications) data.medications = []
  if (!present.falls) data.falls = []
  render(<ProgressPage health={health} active />)
  await ready()
  const medications = within(screen.getByRole('region', { name: '약 변경' }))
  const falls = within(screen.getByRole('region', { name: '낙상' }))
  expect(medications.queryAllByRole('listitem')).toHaveLength(present.medications ? 1 : 0)
  expect(falls.queryAllByRole('listitem')).toHaveLength(present.falls ? 1 : 0)
  expect(Boolean(medications.queryByText('등록한 약 변경이 없어요.'))).toBe(!present.medications)
  expect(Boolean(falls.queryByText('이번 구간에 확인된 낙상 없음'))).toBe(!present.falls)
})
it('경과와 차트는 약 변경을 쉬운 같은 표현으로 보여주고 서버 값과 모르는 표현은 보존한다', async () => {
  data.medications = [
    { name: '첫 번째 약', change_type: '시작', date: '2026-09-01' },
    { name: '두 번째 약', change_type: '증량', date: '2026-09-02' },
    { name: '세 번째 약', change_type: '감량', date: '2026-09-03' },
    { name: '네 번째 약', change_type: '중단', date: '2026-09-04' },
    { name: '기타 약', change_type: '종류 변경', date: '2026-09-05' },
  ]
  const original = structuredClone(data.medications)
  render(<ProgressPage health={health} active />)
  await ready()
  const timeline = within(screen.getByRole('region', { name: '약 변경' }))
  for (const label of [
    '첫 번째 약 · 복용 시작',
    '두 번째 약 · 용량 늘림',
    '세 번째 약 · 용량 줄임',
    '네 번째 약 · 복용 중단',
    '기타 약 · 종류 변경',
  ])
    expect(timeline.getByText(label)).toBeTruthy()
  const { container } = render(
    <TrendChart data={{ ...chart('야간 각성'), medications: data.medications }} />,
  )
  const chartMeds = within(container.querySelector('.mvp-chart-meds') as HTMLElement)
  for (const label of [
    '2026-09-01 · 첫 번째 약 복용 시작',
    '2026-09-02 · 두 번째 약 용량 늘림',
    '2026-09-03 · 세 번째 약 용량 줄임',
    '2026-09-04 · 네 번째 약 복용 중단',
    '2026-09-05 · 기타 약 종류 변경',
  ])
    expect(chartMeds.getByText(label)).toBeTruthy()
  expect(data.medications).toEqual(original)
})
it('근거는 선택한 유형의 선택한 날짜·원문을 열고 떠날 때 닫는다', async () => {
  const note: MemoResult = {
    memo_id: 1,
    record_date: '2026-09-21',
    status: '확인 완료',
    text: '밤에 두 번 깨셨어요.',
    emergency: { matched: false, message: null },
    events: [
      {
        type: '야간 각성',
        status: '있었음',
        count: 2,
        evidence: '밤에 두 번 깨셨어요.',
        time_expr: '밤',
        model_event_index: 0,
      },
    ],
  }
  api.memos.mockResolvedValue([note])
  const user = userEvent.setup()
  const view = render(<ProgressPage health={health} active />)
  await ready()
  await user.click(screen.getByRole('button', { name: /야간 각성, 기준 10%/ }))
  const dialog = screen.getByRole('dialog', { name: '야간 각성 관련 기록' })
  expect(
    await within(dialog).findByRole('heading', { name: '2026년 9월 21일 · 야간 각성' }),
  ).toBeTruthy()
  expect(dialog.querySelector('blockquote')?.textContent).toBe(note.text)
  view.rerender(<ProgressPage health={health} active={false} />)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})
it('경과 상단은 조회 기간만 보여 주고 별도 제외 안내나 비교 기준 날짜를 반복하지 않는다', async () => {
  data.exclusions = {
    pending_memo_ids: [105],
    failed_memo_ids: [109],
  }
  render(<ProgressPage health={health} active />)
  await ready()
  expect(screen.queryByRole('region', { name: '요약에 반영되지 않은 기록' })).toBeNull()
  expect(document.querySelector('.v2-progress-heading')?.textContent).not.toContain('비교 기준')
  expect(screen.getByRole('region', { name: '보고서 기간' })).toBeTruthy()
  expect(data.baseline).toEqual({ start: '2026-05-21', end: '2026-08-19' })
})
it('새 기간을 자동 조회하는 동안과 조회 실패 후에는 이전 기간의 기록일 수를 숨긴다', async () => {
  render(<ProgressPage health={health} active />)
  await ready()
  expect(screen.getByLabelText('기록 커버리지')).toBeTruthy()
  let fail!: (reason: Error) => void
  api.summary.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      fail = reject
    }),
  )
  fireEvent.change(screen.getByLabelText('시작 날짜'), { target: { value: '2026-09-01' } })
  await waitFor(() =>
    expect(api.summary).toHaveBeenLastCalledWith('2026-09-27', '2026-09-01', false),
  )
  expect(screen.queryByLabelText('기록 커버리지')).toBeNull()
  await act(async () => fail(new Error('기간 조회 실패')))
  expect(screen.queryByLabelText('기록 커버리지')).toBeNull()
  expect(screen.getByText('경과를 불러오지 못했어요.')).toBeTruthy()
})
it('실패 후 다시 조회하고 유형 변경 중 늦게 도착한 이전 응답을 버린다', async () => {
  api.trends.mockRejectedValueOnce(new Error('흐름 조회 실패'))
  const user = userEvent.setup()
  render(<ProgressPage health={health} active />)
  const section = await ready()
  await within(section).findByRole('alert')
  await user.click(within(section).getByRole('button', { name: '다시 불러오기' }))
  await screen.findByRole('img', { name: /야간 각성 주간 추이/ })
  expect(api.summary).toHaveBeenCalledTimes(1)
  let finish!: (value: Trends) => void
  api.trends.mockReturnValueOnce(
    new Promise<Trends>((resolve) => {
      finish = resolve
    }),
  )
  await user.selectOptions(screen.getByRole('combobox', { name: '추이 유형' }), '불안')
  await user.selectOptions(screen.getByRole('combobox', { name: '추이 유형' }), '낙상')
  await screen.findByRole('img', { name: /낙상 주간 추이/ })
  await act(async () => finish(chart('불안')))
  expect(screen.queryByRole('img', { name: /불안 주간 추이/ })).toBeNull()
})
it('기록 부족 주는 비율 선에서 제외하고 실제 진료일·약변경일만 점선으로 표시한다', () => {
  const trends = chart('야간 각성')
  trends.weeks.push({
    start: '2026-09-28',
    end: '2026-10-04',
    period: 'current',
    recorded_days: 4,
    event_days: 2,
    rate: 0.5,
    low_coverage: false,
  })
  trends.markers = [
    { kind: 'visit', date: '2026-08-20', label: '진료' },
    { kind: 'medication', date: '2026-09-10', label: '처방약 시작' },
  ]
  render(<TrendChart data={trends} simple />)
  expect(chartRender.points).toMatchObject([
    { recorded_days: 3, lineRate: null, lowRate: 0 },
    { recorded_days: 4, lineRate: 0.5, lowRate: null },
  ])
  expect(chartRender.lines.lineRate.connectNulls).toBe(false)
  expect(chartRender.lines.lowRate.stroke).toBe('none')
  expect(chartRender.references.map((item) => item.label?.value)).toEqual([
    '08/20 진료',
    '09/10 약',
  ])
  expect(screen.getByRole('img').getAttribute('aria-label')).toContain('비율을 표시하지 않고')
})
it('같은 날짜의 여러 약 변경선은 하나로 합치고 원본 목록은 보존한다', () => {
  const trends = chart('야간 각성')
  trends.medications = ['2026-08-25', '2026-09-08', '2026-09-08', '2026-09-16', '2026-09-24'].map(
    (date, i) => ({ name: `예시 약 ${i}`, date, change_type: '시작' }),
  )
  const original = structuredClone(trends.medications)
  render(<TrendChart data={trends} simple />)
  expect(chartRender.references.map((item) => item.label?.value)).toEqual([
    '08/25 약',
    '09/08 약',
    '09/16 약',
    '09/24 약',
  ])
  expect(chartRender.references.map((item) => item.label?.dy)).toEqual([0, -14, -28, 0])
  expect(trends.medications).toEqual(original)
})

it('근거 팝업에서 조회 실패를 재시도하고 같은 유형과 경과 결과를 유지한다', async () => {
  const note: MemoResult = {
    memo_id: 1,
    record_date: '2026-09-24',
    status: '확인 완료',
    text: '밤에 두 번 깨셨어요.',
    emergency: { matched: false, message: null },
    events: [
      {
        type: '야간 각성',
        status: '있었음',
        count: 2,
        evidence: '밤에 두 번 깨셨어요.',
        time_expr: '오늘',
      },
    ],
  }
  api.memos.mockRejectedValueOnce(new Error('원문 연결 오류')).mockResolvedValue([note])
  const user = userEvent.setup()
  render(<ProgressPage health={health} active />)
  await ready()
  await user.click(screen.getByRole('button', { name: /야간 각성, 기준 10%/ }))
  const dialog = screen.getByRole('dialog', { name: '야간 각성 관련 기록' })
  await within(dialog).findByRole('alert')
  await user.click(within(dialog).getByRole('button', { name: '다시 불러오기' }))
  await within(dialog).findByRole('heading', { name: '2026년 9월 24일 · 야간 각성' })
  expect(dialog.querySelector('blockquote')?.textContent).toBe(note.text)
  expect(api.memos).toHaveBeenCalledTimes(2)
  expect(api.summary).toHaveBeenCalledTimes(1)
})

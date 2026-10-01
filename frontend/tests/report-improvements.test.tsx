import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { ProgressPage } from '../src/features/progress/ProgressPage'
import { SummaryPage } from '../src/features/summary/SummaryPage'
import { EvidenceDialog } from '../src/shared/report'
import { reportHref } from '../src/shared/lib/reportSelection'
import { EVENT_TYPES } from '../src/api/types'
import { localToday } from '../src/shared/lib/date'
import type { Health, MemoResult, Summary, Trends } from '../src/api/types'

const api = vi.hoisted(() => ({ summary: vi.fn(), trends: vi.fn(), memos: vi.fn() }))
vi.mock('../src/api', () => ({ api }))
vi.mock('recharts', () => ({
  ResponsiveContainer: () => null,
  LineChart: () => null,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ReferenceLine: () => null,
  ReferenceArea: () => null,
}))
const styles =
  readFileSync('src/shared/report/report.css', 'utf8') +
  readFileSync('src/features/summary/summary.css', 'utf8')
let data: Summary
let stylesheet: HTMLStyleElement
const health = {} as Health
function summaryFixture(): Summary {
  return {
    patient_alias: '가상 검증 대상',
    period: { start: '2026-08-20', end: '2026-09-27' },
    baseline: { start: '2026-05-21', end: '2026-08-19' },
    coverage: { recorded_days: 26, total_days: 39 },
    baseline_coverage: { recorded_days: 80, total_days: 91 },
    exclusions: {
      pending_memo_ids: [],
      failed_memo_ids: [],
    },
    rows: EVENT_TYPES.map((type) => ({
      type,
      baseline_rate: 0.2,
      current_rate: 2 / 26,
      weekly_count: (3 / 26) * 7,
      mark:
        type === '환각' || type === '낙상' ? '새로 나타남' : type === '야간 각성' ? '증가' : null,
      evidence_dates: ['2026-09-22'],
      memo_ids: [1],
      occurrence_days: 2,
      recorded_days: 26,
      baseline_recorded_days: 80,
      baseline_occurrence_days: 16,
      mentioned_days: 5,
      absent_days: 3,
      unmentioned_days: 21,
      baseline_mentioned_days: 20,
      baseline_absent_days: 4,
      baseline_unmentioned_days: 60,
    })),
    sentences: [
      {
        text: '이번 구간에서 처음 발생 기록을 확인했습니다.',
        evidence_dates: ['2026-09-22'],
        memo_ids: [1],
      },
    ],
    medications: [],
    falls: ['2026-09-22'],
    questions: ['밤에 깬 시간\n어떤 내용을 더 기록할까요?'],
    disclaimer: '보호자 기록의 정리본입니다.',
  }
}
function chart(type = '야간 각성'): Trends {
  return {
    type: type as Trends['type'],
    period: data.period,
    baseline: data.baseline,
    weeks: [],
    medications: [],
  }
}
function setHash(hash: string) {
  window.history.replaceState(null, '', hash)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}
async function ready() {
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'PDF로 저장' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  )
}
function nativePrintShowsReport() {
  const print = document.createElement('style')
  print.textContent = Array.from(stylesheet.sheet!.cssRules)
    .filter(
      (rule): rule is CSSMediaRule =>
        'media' in rule && (rule as CSSMediaRule).media.mediaText === 'print',
    )
    .flatMap((rule) => Array.from(rule.cssRules).map((child) => child.cssText))
    .join('\n')
  document.head.append(print)
  try {
    const report = document.querySelector('.mvp-print-copy')
    return Boolean(report && getComputedStyle(report).display !== 'none')
  } finally {
    print.remove()
  }
}
beforeEach(() => {
  data = summaryFixture()
  setHash('#summary?as_of=2026-09-27')
  api.summary.mockResolvedValue(data)
  api.trends.mockImplementation((type: string) => Promise.resolve(chart(type)))
  api.memos.mockResolvedValue([])
  stylesheet = document.createElement('style')
  stylesheet.textContent = styles
  document.head.append(stylesheet)
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  })
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  })
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
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
  vi.spyOn(window, 'print').mockImplementation(() => {})
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('mvp-print-copy') ? 800 : 0
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 700,
      bottom: 1000,
      width: 700,
      height: this.classList.contains('mvp-print-limit') ? 1000 : 700,
      toJSON: () => ({}),
    }
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: () => void) {}
      observe() {
        this.callback()
      }
      disconnect() {}
      unobserve() {}
    },
  )
})
afterEach(() => {
  cleanup()
  stylesheet.remove()
  vi.unstubAllGlobals()
})

it('경과에서 고른 날짜와 고정 시작일을 요약 API·추이·복사 주소까지 전달한다', async () => {
  setHash('#progress?as_of=2026-09-27')
  const progress = render(<ProgressPage health={health} active />)
  await screen.findByRole('region', { name: '주요 관찰 기록' })
  // Advance the date-input debounce explicitly so parallel test load cannot consume waitFor's deadline.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    fireEvent.change(screen.getByLabelText('마지막 날짜'), { target: { value: '2026-09-26' } })
    expect(api.summary).toHaveBeenLastCalledWith('2026-09-27', undefined, false)
    expect(window.location.hash).not.toContain('period_start')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
  } finally {
    vi.useRealTimers()
  }
  await waitFor(() =>
    expect(api.summary).toHaveBeenLastCalledWith('2026-09-26', '2026-08-20', false),
  )
  await waitFor(() =>
    expect(api.trends).toHaveBeenCalledWith('야간 각성', '2026-09-26', '2026-08-20'),
  )
  expect(screen.queryByRole('link', { name: '요약지 미리보기' })).toBeNull()
  const destination = reportHref('summary')
  expect(destination).toBe('#summary?as_of=2026-09-26&period_start=2026-08-20')
  progress.unmount()
  setHash(destination)
  render(<SummaryPage health={health} active />)
  await ready()
  expect((screen.getByLabelText('마지막 날짜') as HTMLInputElement).value).toBe('2026-09-26')
  expect((screen.getByLabelText('시작 날짜') as HTMLInputElement).value).toBe('2026-08-20')
  fireEvent.click(screen.getByRole('button', { name: 'PDF로 저장' }))
  fireEvent.click(screen.getByRole('button', { name: '주소 복사' }))
  await waitFor(() =>
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(window.location.href),
  )
  expect(window.location.href).toContain(destination)
})

it('외부 주소로 선택을 복원하고 뒤로가기로 이전 고정 구간의 완료 결과를 재사용한다', async () => {
  setHash('#summary?as_of=2026-09-26&period_start=2026-08-20')
  render(<SummaryPage health={health} active />)
  await ready()
  expect(api.summary).toHaveBeenLastCalledWith('2026-09-26', '2026-08-20', true)
  fireEvent.change(screen.getByLabelText('시작 날짜'), { target: { value: '2026-08-01' } })
  await waitFor(() =>
    expect(api.summary).toHaveBeenLastCalledWith('2026-09-26', '2026-08-01', true),
  )
  await act(async () => {
    window.history.back()
  })
  await waitFor(() =>
    expect((screen.getByLabelText('시작 날짜') as HTMLInputElement).value).toBe('2026-08-20'),
  )
  expect(api.summary).toHaveBeenCalledTimes(2)
  expect(api.summary).toHaveBeenLastCalledWith('2026-09-26', '2026-08-01', true)
  fireEvent.click(screen.getByRole('button', { name: '기본 기간으로 돌아가기' }))
  await waitFor(() => expect(api.summary).toHaveBeenLastCalledWith(undefined, undefined, true))
  expect(window.location.hash).not.toContain('period_start')
  expect(window.location.hash).not.toContain('as_of')
})

it('종료일만 고정한 주소에서도 기본 기간으로 돌아가 오늘까지 다시 조회한다', async () => {
  setHash('#summary?as_of=2026-09-26')
  render(<SummaryPage health={health} active />)
  await ready()
  fireEvent.click(screen.getByRole('button', { name: '기본 기간으로 돌아가기' }))
  await waitFor(() => expect(api.summary).toHaveBeenLastCalledWith(undefined, undefined, true))
  expect(window.location.hash).toBe('#summary')
})

it('PDF 버튼에서 제외 기록을 확인하고 마지막 선택과 같은 클릭에서 안전하게 출력한다', async () => {
  data.exclusions = {
    pending_memo_ids: [105, 106],
    failed_memo_ids: [109],
  }
  setHash('#summary?as_of=2026-09-27&period_start=2026-08-20')
  render(<SummaryPage health={health} active />)
  await ready()
  expect(screen.queryByRole('checkbox')).toBeNull()
  expect(screen.queryByRole('region', { name: '요약에 반영되지 않은 기록' })).toBeNull()
  const controls = screen.getByRole('region', { name: '요약 기간과 PDF 저장' })
  expect(within(controls).getByRole('button', { name: 'PDF로 저장' })).toBeTruthy()
  expect(reportHref('progress')).not.toContain('memo=')
  expect(nativePrintShowsReport()).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'PDF로 저장' }))
  expect(window.print).not.toHaveBeenCalled()
  const dialog = screen.getByRole('dialog', { name: '출력 전 기록 확인' })
  expect(
    within(dialog).getByRole('region', { name: '요약에 반영되지 않은 기록' }).textContent,
  ).toContain('확인 대기 메모 2건 · 정리 실패 메모 1건')
  expect(
    within(dialog).getByRole('link', { name: '정리 실패 메모 109번 열기' }).getAttribute('href'),
  ).toBe('#record?memo=109&return_to=summary-print&as_of=2026-09-27&period_start=2026-08-20')
  expect(
    within(dialog).getByRole('link', { name: '기록 확인하러 가기' }).getAttribute('href'),
  ).toBe(
    '#record?view=history&from=2026-08-20&to=2026-09-27&as_of=2026-09-27&period_start=2026-08-20',
  )
  vi.mocked(window.print).mockImplementation(() => {
    expect(nativePrintShowsReport()).toBe(true)
    expect(screen.queryByRole('dialog', { name: '출력 전 기록 확인' })).toBeNull()
  })
  fireEvent.click(within(dialog).getByRole('button', { name: '확인된 기록만 출력' }))
  expect(window.print).toHaveBeenCalledOnce()
  expect(document.querySelector('.mvp-print-copy')?.textContent).not.toMatch(
    /집계 제외|확인 대기 메모|정리 실패 메모/,
  )
  expect(screen.getByRole('region', { name: 'A4 요약지 미리보기' }).textContent).not.toMatch(
    /집계 제외|확인 대기 메모|정리 실패 메모/,
  )
  expect(document.querySelector('.v2-mobile-summary')?.textContent).not.toMatch(
    /집계 제외|확인 대기 메모|정리 실패 메모/,
  )
})

it('제외 내역을 확인한 뒤 새 결과를 불러오면 이전 확인으로 출력하지 않는다', async () => {
  data.exclusions = {
    pending_memo_ids: [105],
    failed_memo_ids: [],
  }
  render(<SummaryPage health={health} active />)
  await ready()
  fireEvent.click(screen.getByRole('button', { name: 'PDF로 저장' }))
  fireEvent.click(screen.getByRole('button', { name: '확인된 기록만 출력' }))
  fireEvent(window, new Event('afterprint'))
  api.summary.mockResolvedValueOnce({
    ...data,
    exclusions: { ...data.exclusions, failed_memo_ids: [109] },
  })
  fireEvent.click(screen.getByRole('button', { name: '새로 불러오기' }))
  await ready()
  expect(nativePrintShowsReport()).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'PDF로 저장' }))
  const dialog = screen.getByRole('dialog', { name: '출력 전 기록 확인' })
  expect(dialog.textContent).toContain('정리 실패 메모 1건')
  expect(window.print).toHaveBeenCalledOnce()
  fireEvent.click(within(dialog).getByRole('button', { name: '닫기' }))
  expect(nativePrintShowsReport()).toBe(false)
})

it('실패 기록만 있어도 PDF 확인 창의 대표 링크는 같은 기간의 지난 기록 목록을 연다', async () => {
  data.exclusions = { pending_memo_ids: [], failed_memo_ids: [109, 110] }
  setHash('#summary?as_of=2026-09-27&period_start=2026-08-20')
  render(<SummaryPage health={health} active />)
  await ready()
  fireEvent.click(screen.getByRole('button', { name: 'PDF로 저장' }))
  const dialog = screen.getByRole('dialog', { name: '출력 전 기록 확인' })
  expect(
    within(dialog).getByRole('link', { name: '기록 확인하러 가기' }).getAttribute('href'),
  ).toBe(
    '#record?view=history&from=2026-08-20&to=2026-09-27&as_of=2026-09-27&period_start=2026-08-20',
  )
  expect(within(dialog).getByRole('link', { name: '정리 실패 메모 110번 열기' })).toBeTruthy()
  expect(window.print).not.toHaveBeenCalled()
})

it('출력 확인 중 새 조회를 시작하거나 화면을 떠나면 확인 창을 닫고 이전 결과를 출력하지 않는다', async () => {
  data.exclusions = { pending_memo_ids: [105], failed_memo_ids: [] }
  const view = render(<SummaryPage health={health} active />)
  await ready()
  fireEvent.click(screen.getByRole('button', { name: 'PDF로 저장' }))
  expect(screen.getByRole('dialog', { name: '출력 전 기록 확인' })).toBeTruthy()
  let resolve!: (value: Summary) => void
  api.summary.mockReturnValueOnce(
    new Promise<Summary>((done) => {
      resolve = done
    }),
  )
  fireEvent.click(screen.getByRole('button', { name: '새로 불러오기' }))
  expect(screen.queryByRole('dialog', { name: '출력 전 기록 확인' })).toBeNull()
  expect(nativePrintShowsReport()).toBe(false)
  await act(async () => resolve({ ...data }))
  await ready()
  fireEvent.click(screen.getByRole('button', { name: 'PDF로 저장' }))
  view.rerender(<SummaryPage health={health} active={false} />)
  expect(screen.queryByRole('dialog', { name: '출력 전 기록 확인' })).toBeNull()
  view.rerender(<SummaryPage health={health} active />)
  await ready()
  expect(screen.queryByRole('dialog', { name: '출력 전 기록 확인' })).toBeNull()
  expect(nativePrintShowsReport()).toBe(false)
  expect(window.print).not.toHaveBeenCalled()
})

it('경과는 표시된 관찰과 낙상 카드를 보여 주고 커버리지는 상단에 표시한다', async () => {
  data.rows.find((row) => row.type === '초조·공격')!.mark = '증가'
  data.rows.find((row) => row.type === '불안')!.mark = '증가'
  setHash('#progress?as_of=2026-09-27')
  render(<ProgressPage health={health} active />)
  const primary = await screen.findByRole('region', { name: '주요 관찰 기록' })
  const cards = within(primary).getAllByRole('button')
  expect(cards).toHaveLength(5)
  expect(primary.textContent).not.toContain('기록 커버리지')
  expect((await screen.findByLabelText('기록 커버리지')).textContent).toContain('39일 중 26일 기록')
  expect(
    within(primary).getByRole('button', { name: '낙상 관련 기록 보기' }).textContent,
  ).toContain('항상 표시')
  expect(primary.textContent).not.toMatch(/언급 없음|이전에는/)
  expect(screen.queryByText('전체 관찰 항목 보기')).toBeNull()
  expect(screen.queryByText('비율과 계산 자세히 보기')).toBeNull()
  expect(screen.getByRole('heading', { name: '주간 추이' }).closest('details')).toBeNull()
  const select = screen.getByRole('combobox', { name: '추이 유형' })
  expect(within(select).getAllByRole('option')).toHaveLength(EVENT_TYPES.length)
  fireEvent.change(select, { target: { value: '복약 거부' } })
  await waitFor(() =>
    expect(api.trends).toHaveBeenLastCalledWith('복약 거부', '2026-09-27', undefined),
  )
})

it('PDF는 0%와 작은 양수 비율을 구분하고 과거 관찰을 보존하며 기록일은 보조정보에 한 번만 남긴다', async () => {
  data.rows = [
    {
      ...data.rows[0],
      baseline_rate: 0,
      baseline_occurrence_days: 0,
      current_rate: 1 / 240,
      occurrence_days: 1,
      recorded_days: 240,
      weekly_count: 7 / 240,
      mark: '새로 나타남',
    },
    {
      ...data.rows[1],
      baseline_rate: 2 / 80,
      baseline_occurrence_days: 2,
      current_rate: 0,
      occurrence_days: 0,
      recorded_days: 240,
      mark: null,
    },
    {
      ...data.rows[2],
      baseline_rate: 0,
      baseline_occurrence_days: 0,
      current_rate: 0,
      occurrence_days: 0,
      recorded_days: 240,
      mark: null,
    },
  ]
  data.coverage = { recorded_days: 240, total_days: 260 }
  render(<SummaryPage health={health} active />)
  await ready()
  const paper = document.querySelector('.mvp-print-copy')!
  expect(paper.textContent).toContain('<1%')
  expect(paper.querySelector('thead')?.textContent).not.toMatch(/80일|240일/)
  expect(paper.querySelector('.v2-paper-header')?.textContent).toContain('240일 / 260일')
  const rows = paper.querySelectorAll('tbody tr')
  expect(rows).toHaveLength(3)
  expect(
    Array.from(rows[0].querySelectorAll('td'))
      .slice(0, 2)
      .map((cell) => cell.textContent),
  ).toEqual(['0%', '<1%'])
  expect(
    Array.from(rows[1].querySelectorAll('td'))
      .slice(0, 2)
      .map((cell) => cell.textContent),
  ).toEqual(['3%', '0%'])
  expect(paper.querySelector('tbody')?.textContent).toContain(data.rows[2].type)
  expect(screen.queryByText('비율과 계산 자세히 보기')).toBeNull()
})

it('기준일을 바꾼 뒤 새 요청이 끝나기 전에는 이전 요약을 인쇄할 수 없다', async () => {
  render(<SummaryPage health={health} active />)
  await ready()
  let resolve!: (value: Summary) => void
  api.summary.mockReturnValueOnce(
    new Promise<Summary>((done) => {
      resolve = done
    }),
  )
  fireEvent.change(screen.getByLabelText('마지막 날짜'), { target: { value: '2026-09-26' } })
  expect((screen.getByRole('button', { name: 'PDF로 저장' }) as HTMLButtonElement).disabled).toBe(
    true,
  )
  expect(nativePrintShowsReport()).toBe(false)
  await waitFor(() =>
    expect(api.summary).toHaveBeenLastCalledWith('2026-09-26', '2026-08-20', true),
  )
  expect(nativePrintShowsReport()).toBe(false)
  expect(document.querySelector('.mvp-print-copy')).toBeNull()
  await act(async () => resolve({ ...data, period: { ...data.period, end: '2026-09-26' } }))
  await ready()
  expect(nativePrintShowsReport()).toBe(true)
})

it('미래 기준일 공유 주소는 첫 API 호출 전 오늘로 바꾸고 고정한 과거 시작일은 보존한다', async () => {
  setHash('#summary?as_of=9999-01-01&period_start=2026-08-20')
  render(<SummaryPage health={health} active />)
  await ready()
  const today = localToday()
  expect((screen.getByLabelText('마지막 날짜') as HTMLInputElement).value).toBe(today)
  expect(
    screen.getByText(`미래 날짜는 요약 기준일로 사용할 수 없어 오늘(${today})로 바꿨어요.`),
  ).toBeTruthy()
  expect(api.summary).toHaveBeenLastCalledWith(today, '2026-08-20', true)
  expect(api.summary.mock.calls.every((call) => call[0] <= today)).toBe(true)
  expect(api.trends.mock.calls.every((call) => call[1] === today)).toBe(true)
  expect(window.location.hash).toBe(`#summary?as_of=${today}&period_start=2026-08-20`)
  fireEvent.click(screen.getByRole('button', { name: 'PDF로 저장' }))
  fireEvent.click(screen.getByRole('button', { name: '주소 복사' }))
  await waitFor(() =>
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(window.location.href),
  )
  expect(window.location.href).not.toContain('9999-01-01')
})

it('미래 URL의 고정 시작일까지 오늘보다 뒤이면 해제 이유를 알리고 자동 구간으로 복구한다', async () => {
  setHash('#summary?as_of=9999-02-01&period_start=9999-01-01')
  render(<SummaryPage health={health} active />)
  await ready()
  expect(api.summary).toHaveBeenLastCalledWith(localToday(), undefined, true)
  expect(window.location.hash).toBe(`#summary?as_of=${localToday()}`)
  expect(screen.getByText(/오늘보다 뒤인 시작일 고정도 해제했어요/)).toBeTruthy()
  expect(screen.queryByText('기간 바꾸기')).toBeNull()
  expect(screen.queryByRole('button', { name: '이 기간으로 보기' })).toBeNull()
})

it('입력창의 미래일도 오늘로 정규화하고 유효한 과거일로 바꾸면 이전 안내를 지운다', async () => {
  setHash('#progress?as_of=2026-09-26&period_start=2026-08-20')
  render(<ProgressPage health={health} active />)
  await screen.findByRole('region', { name: '주요 관찰 기록' })
  fireEvent.change(screen.getByLabelText('마지막 날짜'), { target: { value: '9999-01-01' } })
  expect(api.summary).toHaveBeenLastCalledWith('2026-09-26', '2026-08-20', false)
  expect((screen.getByLabelText('마지막 날짜') as HTMLInputElement).value).toBe(localToday())
  expect(screen.getByText(/미래 날짜는 사용할 수 없어/)).toBeTruthy()
  await waitFor(() =>
    expect(api.summary).toHaveBeenLastCalledWith(localToday(), '2026-08-20', false),
  )
  expect(api.summary.mock.calls.some((call) => call[0] === '9999-01-01')).toBe(false)
  fireEvent.change(screen.getByLabelText('마지막 날짜'), { target: { value: '2026-09-25' } })
  await waitFor(() =>
    expect(api.summary).toHaveBeenLastCalledWith('2026-09-25', '2026-08-20', false),
  )
  expect(screen.queryByText(/미래 날짜는 사용할 수 없어/)).toBeNull()
})

function sourceMemo(
  id: number,
  recordDate: string,
  status: '있었음' | '없었음',
  quote: string,
): MemoResult {
  return {
    memo_id: id,
    status: '확인 완료',
    record_date: recordDate,
    text: `그날의 관찰 메모. ${quote}`,
    emergency: { matched: false, message: null },
    events: [
      {
        type: '낙상',
        status,
        time_expr: '오후',
        count: 1,
        evidence: quote,
      },
    ],
  }
}

it('경과의 관찰 카드는 추가 버튼을 찾지 않아도 선택한 날짜의 관련 원문을 바로 연다', async () => {
  const fall = sourceMemo(1, '2026-09-09', '있었음', '오후에 욕실에서 넘어지셨다.')
  api.memos.mockResolvedValue([fall])
  setHash('#progress?as_of=2026-09-27')
  render(<ProgressPage health={health} active />)
  const primary = await screen.findByRole('region', { name: '주요 관찰 기록' })
  fireEvent.click(within(primary).getByRole('button', { name: '낙상 관련 기록 보기' }))
  const dialog = await screen.findByRole('dialog', { name: '낙상 관련 기록' })
  await within(dialog).findByRole('heading', { name: '2026년 9월 9일 · 낙상' })
  expect(dialog.querySelector('blockquote')?.textContent).toBe(fall.events[0].evidence)
  await waitFor(() => expect(api.trends).toHaveBeenLastCalledWith('낙상', '2026-09-27', undefined))
})

it('관련 기록은 선택한 날짜의 해당 유형과 인용을 먼저 보여 주고 없었음·다른 유형을 발생 사례로 쓰지 않는다', async () => {
  const happened = sourceMemo(
    95,
    '2026-09-09',
    '있었음',
    '오후에 욕실 입구에서 발을 헛디뎌 바닥에 주저앉으셨다.',
  )
  happened.events.push({ ...happened.events[0], type: '불안', evidence: '외출을 걱정하셨다.' })
  const absent = sourceMemo(96, '2026-09-13', '없었음', '오늘은 넘어지지 않으셨다.')
  api.memos.mockResolvedValue([happened, absent])
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
  render(
    <EvidenceDialog
      selection={{
        title: '낙상 관련 기록',
        type: '낙상',
        ids: [95, 96],
        dates: [],
        period: data.period,
      }}
      onClose={() => {}}
    />,
  )
  const dialog = await screen.findByRole('dialog')
  await within(dialog).findByRole('heading', { name: '2026년 9월 9일 · 낙상' })
  const first = dialog.querySelector('.mvp-evidence-memo')!
  expect(first.querySelector('blockquote')?.textContent).toBe(happened.events[0].evidence)
  expect(first.textContent).toContain('있었다고 기록 · 1회')
  const full = first.querySelector('details')!
  expect(full.open).toBe(false)
  expect(full.textContent).toContain(happened.text)
  expect(full.textContent).not.toContain('작성')
  expect(first.querySelectorAll('h3')).toHaveLength(1)
  expect(within(dialog).queryByText('외출을 걱정하셨다.')).toBeNull()
  const other = dialog.querySelector('.mvp-other-evidence') as HTMLDetailsElement
  expect(other.open).toBe(false)
  fireEvent.click(within(other).getByText(/이전 기록·없었다고 적은 내용/))
  expect(within(other).getByText('없었다고 적은 기록')).toBeTruthy()
  expect(other.textContent).not.toContain('있었다고 기록')
})

it('기록일 근거 팝업은 사건 유무와 무관하게 선택한 날짜의 메모만 보여 준다', async () => {
  const observed = {
    ...sourceMemo(1, '2026-09-21', '있었음', '오후에 넘어지셨다.'),
    created_at: '2026-09-28T10:00:00',
  }
  const everyday = { ...observed, memo_id: 2, text: '함께 사진을 보았다.', events: [] }
  const outside = { ...observed, memo_id: 3, record_date: '2026-09-22', text: '다음 날의 메모' }
  api.memos.mockResolvedValue([observed, everyday, outside])
  render(
    <EvidenceDialog
      selection={{
        title: '기록일 근거',
        kind: 'coverage',
        ids: [1, 2, 3],
        dates: [],
        period: { start: '2026-09-21', end: '2026-09-21' },
      }}
      onClose={() => {}}
    />,
  )

  const dialog = await screen.findByRole('dialog', { name: '기록일 근거' })
  await waitFor(() => expect(dialog.querySelectorAll('article')).toHaveLength(2))
  expect(within(dialog).getAllByRole('heading', { name: '2026년 9월 21일' })).toHaveLength(2)
  expect(dialog.textContent).toContain(observed.text)
  expect(dialog.textContent).toContain(everyday.text)
  expect(dialog.textContent).not.toContain(outside.text)
  expect(dialog.textContent).not.toContain('9월 28일')
  expect(dialog.textContent).not.toContain('작성')
})

it('기간 입력은 처음부터 보이며 연속으로 바꾼 두 날짜를 한 번에 자동 적용한다', async () => {
  render(<SummaryPage health={health} active />)
  await ready()
  api.summary.mockClear()
  const previous = window.location.hash
  fireEvent.change(screen.getByLabelText('시작 날짜'), { target: { value: '2026-06-01' } })
  fireEvent.change(screen.getByLabelText('마지막 날짜'), { target: { value: '2026-06-30' } })
  expect(api.summary).not.toHaveBeenCalled()
  expect(window.location.hash).toBe(previous)
  await waitFor(() =>
    expect(api.summary).toHaveBeenCalledExactlyOnceWith('2026-06-30', '2026-06-01', true),
  )
  expect(window.location.hash).toBe('#summary?as_of=2026-06-30&period_start=2026-06-01')
  expect(screen.queryByText('기간 바꾸기')).toBeNull()
})
it('기간 입력을 취소하면 원래 범위를 유지하고 시작일이 종료일 뒤인 선택은 적용하지 않는다', async () => {
  render(<SummaryPage health={health} active />)
  await ready()
  api.summary.mockClear()
  const previous = window.location.hash
  fireEvent.change(screen.getByLabelText('시작 날짜'), { target: { value: '2026-09-28' } })
  expect(screen.getByRole('alert').textContent).toContain(
    '시작 날짜는 마지막 날짜보다 늦을 수 없어요.',
  )
  expect(screen.queryByRole('button', { name: '이 기간으로 보기' })).toBeNull()
  fireEvent.keyDown(screen.getByLabelText('시작 날짜'), { key: 'Escape' })
  expect(api.summary).not.toHaveBeenCalled()
  expect(window.location.hash).toBe(previous)
  expect((screen.getByLabelText('시작 날짜') as HTMLInputElement).value).toBe('2026-08-20')
})

it('기간 변경을 취소하거나 화면을 떠나거나 Escape를 누르면 미적용 날짜를 되돌린다', async () => {
  const view = render(<SummaryPage health={health} active />)
  await ready()
  fireEvent.change(screen.getByLabelText('시작 날짜'), { target: { value: '2026-09-01' } })
  fireEvent.keyDown(screen.getByLabelText('시작 날짜'), { key: 'Escape' })
  expect((screen.getByLabelText('시작 날짜') as HTMLInputElement).value).toBe('2026-08-20')
  fireEvent.change(screen.getByLabelText('시작 날짜'), { target: { value: '2026-09-02' } })
  view.rerender(<SummaryPage health={health} active={false} />)
  view.rerender(<SummaryPage health={health} active />)
  expect((screen.getByLabelText('시작 날짜') as HTMLInputElement).value).toBe('2026-08-20')
  fireEvent.change(screen.getByLabelText('시작 날짜'), { target: { value: '2026-09-03' } })
  fireEvent.keyDown(screen.getByLabelText('시작 날짜'), { key: 'Escape' })
  expect((screen.getByLabelText('시작 날짜') as HTMLInputElement).value).toBe('2026-08-20')
  expect(screen.queryByRole('button', { name: '취소' })).toBeNull()
  expect(api.summary).toHaveBeenCalledTimes(1)
})
it('숨겨진 요약의 기간 보정 알림은 다른 화면 위에 열리지 않는다', async () => {
  setHash('#record?as_of=2099-01-01')
  const view = render(<SummaryPage health={health} active={false} />)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(api.summary).not.toHaveBeenCalled()
  view.rerender(<SummaryPage health={health} active />)
  const dialog = await screen.findByRole('dialog', { name: '기간을 확인해 주세요' })
  expect(dialog.textContent).toContain('미래 날짜는 요약 기준일로 사용할 수 없어')
  fireEvent.click(within(dialog).getByRole('button', { name: '확인' }))
  expect(screen.queryByRole('dialog')).toBeNull()
})

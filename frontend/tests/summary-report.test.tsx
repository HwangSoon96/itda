import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { SummaryPage } from '../src/features/summary/SummaryPage'
import { summaryTrendTypes } from '../src/features/summary/model'
import { ExcludedRecords } from '../src/shared/report/ExcludedRecords'
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
let stylesheet: HTMLStyleElement
let data: Summary
let coreOverflows: boolean
const question = '지난 진료 이후 밤에 깨는 날이 늘어난 기록을 함께 확인하고 싶습니다.'
function fixture(): Summary {
  const value: Summary = {
    patient_alias: '검증 대상',
    period: { start: '2026-08-20', end: '2026-09-27' },
    baseline: { start: '2026-05-21', end: '2026-08-19' },
    coverage: { recorded_days: 30, total_days: 39 },
    baseline_coverage: { recorded_days: 80, total_days: 91 },
    summary_source: 'template',
    basis_note: '기록일 중 발생일의 비율. 주당 환산은 기록일당 평균 횟수 × 7.',
    rows: [
      {
        type: '야간 각성',
        baseline_rate: 0.1,
        current_rate: 0.5,
        weekly_count: 3.5,
        mark: '증가',
        evidence_dates: ['2026-09-22'],
        memo_ids: [1],
        occurrence_days: 15,
        recorded_days: 30,
        baseline_occurrence_days: 8,
      },
    ],
    sentences: [
      {
        text: '야간 각성: 발생일 비율이 기준 구간 10%에서 이번 구간 50%로 증가 표시됨 (기록일 30일 중 15일).',
        types: ['야간 각성'],
        evidence_dates: ['2026-09-22'],
        memo_ids: [1],
      },
    ],
    medications: [{ name: '등록한 약', change_type: '증량', date: '2026-09-10' }],
    falls: ['2026-09-18'],
    questions: [question],
    disclaimer: '보호자 일지 자동 정리본입니다.',
  }
  value.trends = [
    {
      type: '야간 각성',
      period: value.period,
      baseline: value.baseline,
      weeks: [],
      medications: [],
    },
  ]
  return value
}
function source(id = 1): MemoResult {
  return {
    memo_id: id,
    status: '확인 완료',
    record_date: '2026-09-22',
    text: '밤에 두 번 깨셨다. 함께 거실에 잠시 앉아 있었다.',
    emergency: { matched: false, message: null },
    events: [
      {
        type: '야간 각성',
        status: '있었음',
        time_expr: '밤',
        count: 2,
        evidence: '밤에 두 번 깨셨다.',
      },
    ],
  }
}
function setHash(hash: string) {
  window.history.replaceState(null, '', hash)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}
const printButton = () => screen.getByRole('button', { name: 'PDF로 저장' }) as HTMLButtonElement
async function ready() {
  await waitFor(() => expect(printButton().disabled).toBe(false))
}
function printContent() {
  return document.querySelector('.v2-print-copy')!
}
function applyPrintStyles() {
  const element = document.createElement('style')
  element.textContent = Array.from(stylesheet.sheet!.cssRules)
    .filter(
      (rule): rule is CSSMediaRule =>
        'media' in rule && (rule as CSSMediaRule).media.mediaText === 'print',
    )
    .flatMap((rule) => Array.from(rule.cssRules).map((child) => child.cssText))
    .join('\n')
  document.head.append(element)
  return element
}
beforeEach(() => {
  data = fixture()
  coreOverflows = false
  setHash('#summary?as_of=2026-09-27')
  api.summary.mockResolvedValue(data)
  api.trends.mockResolvedValue(data.trends![0])
  api.memos.mockResolvedValue([source()])
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
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
  vi.spyOn(window, 'print').mockImplementation(() => {})
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('v2-page-core')
      ? coreOverflows && Boolean(this.querySelector('tbody')?.textContent?.includes('우울·무기력'))
        ? 1200
        : 800
      : 0
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 700,
    bottom: 1000,
    width: 700,
    height: 1000,
    toJSON: () => ({}),
  }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  )
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  )
})
afterEach(() => {
  cleanup()
  stylesheet.remove()
  vi.unstubAllGlobals()
})

it('AI를 기본 요청하고 응답의 생성 주체를 표시하며 문장 틀로 즉시 전환할 수 있다', async () => {
  data.summary_source = 'llm'
  render(<SummaryPage health={{} as Health} active />)
  await ready()
  expect(api.summary).toHaveBeenLastCalledWith('2026-09-27', undefined, true)
  expect(printContent().textContent).toContain('AI가 작성한 요약')
  api.summary.mockResolvedValueOnce({ ...data, summary_source: 'template' })
  fireEvent.click(screen.getByRole('button', { name: '문장 틀로 빠르게 보기' }))
  await waitFor(() => expect(api.summary).toHaveBeenLastCalledWith('2026-09-27', undefined, false))
  await ready()
  expect(printContent().textContent).toContain('자동 정리된 요약')
  fireEvent.click(screen.getByRole('button', { name: 'AI 요약 보기' }))
  await ready()
  expect(printContent().textContent).toContain('AI가 작성한 요약')
  expect(api.summary).toHaveBeenCalledTimes(2)
})
it('AI를 기다리는 동안에도 문장 틀로 빠르게 보기를 누를 수 있고 늦은 AI 응답은 무시한다', async () => {
  let finish!: (value: Summary) => void
  api.summary.mockReturnValueOnce(
    new Promise<Summary>((resolve) => {
      finish = resolve
    }),
  )
  render(<SummaryPage health={{} as Health} active />)
  expect(printButton().disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '문장 틀로 빠르게 보기' }))
  await ready()
  await act(async () =>
    finish({ ...data, patient_alias: '늦게 온 이전 응답', summary_source: 'llm' }),
  )
  expect(printContent().textContent).not.toContain('늦게 온 이전 응답')
})
it('첫 장에는 핵심 요약·표·질문, 상세 장에는 그래프와 독립된 약 변경·낙상 영역을 배치한다', async () => {
  data.trends = ['야간 각성', '배회·출입문 시도', '초조·공격'].map((type) => ({
    ...data.trends![0],
    type: type as Trends['type'],
  }))
  render(<SummaryPage health={{} as Health} active />)
  await ready()
  const paper = printContent()
  const front = paper.querySelector('.v2-page-core')!
  const back = paper.querySelector('.v2-page-detail')!
  expect(paper.querySelectorAll('.v2-paper')).toHaveLength(2)
  expect(front.textContent).toContain(question)
  expect(front.querySelectorAll('tbody tr')).toHaveLength(1)
  expect(front.querySelector('.v2-report-charts')).toBeNull()
  expect(back.querySelectorAll('.v2-report-chart')).toHaveLength(3)
  const medications = back.querySelector('section[aria-label="약 변경"]')!
  const falls = back.querySelector('section[aria-label="낙상"]')!
  expect(medications.textContent).toContain('2026-09-10')
  expect(medications.textContent).not.toContain('2026-09-18')
  expect(falls.textContent).toContain('2026-09-18')
  expect(falls.textContent).not.toContain('등록한 약')
  expect(api.trends).not.toHaveBeenCalled()
  const style = applyPrintStyles()
  expect(getComputedStyle(back).breakBefore).toBe('page')
  style.remove()
})
it('모바일·A4 미리보기·출력의 약 변경 문구를 통일하고 약 이름·날짜·서버 값은 보존한다', async () => {
  data.medications = [
    { name: '첫 번째 약', change_type: '시작', date: '2026-09-01' },
    { name: '두 번째 약', change_type: '증량', date: '2026-09-02' },
    { name: '세 번째 약', change_type: '감량', date: '2026-09-03' },
    { name: '네 번째 약', change_type: '중단', date: '2026-09-04' },
  ]
  const original = structuredClone(data.medications)
  render(<SummaryPage health={{} as Health} active />)
  await ready()
  const chronologies = document.querySelectorAll('.v2-medication-history')
  expect(chronologies.length).toBeGreaterThanOrEqual(3)
  for (const chronology of chronologies) {
    for (const label of [
      '첫 번째 약 · 복용 시작',
      '두 번째 약 · 용량 늘림',
      '세 번째 약 · 용량 줄임',
      '네 번째 약 · 복용 중단',
    ])
      expect(chronology.textContent).toContain(label)
    for (const medication of original) expect(chronology.textContent).toContain(medication.date)
  }
  expect(printContent().textContent).toContain('두 번째 약 · 용량 늘림')
  expect(data.medications).toEqual(original)
})
it('모바일·미리보기·PDF에서 약 변경과 낙상을 섞지 않고 각 날짜순으로 보여준다', async () => {
  data.medications = [
    { name: '마지막 약', change_type: '중단', date: '2026-09-20' },
    { name: '첫 번째 약', change_type: '시작', date: '2026-09-01' },
    { name: '같은 날의 다른 약', change_type: '증량', date: '2026-09-01' },
  ]
  data.falls = ['2026-09-18', '2026-09-01']
  const originalMedications = structuredClone(data.medications)
  const originalFalls = [...data.falls]
  render(<SummaryPage health={{} as Health} active />)
  await ready()
  for (const selector of ['.v2-mobile-summary', '.v2-paper-preview', '.v2-print-copy']) {
    const view = document.querySelector(selector) as HTMLElement
    const medications = view.querySelector('section[aria-label="약 변경"]')!
    const falls = view.querySelector('section[aria-label="낙상"]')!
    expect([...medications.querySelectorAll('time')].map((item) => item.dateTime)).toEqual([
      '2026-09-01',
      '2026-09-01',
      '2026-09-20',
    ])
    expect([...falls.querySelectorAll('time')].map((item) => item.dateTime)).toEqual([
      '2026-09-01',
      '2026-09-18',
    ])
    expect(medications.textContent).toContain('같은 날의 다른 약')
    expect(medications.textContent).not.toContain('낙상')
    expect(falls.textContent).not.toContain('약')
  }
  expect(data.medications).toEqual(originalMedications)
  expect(data.falls).toEqual(originalFalls)
})
it.each([
  { hasMedications: false, hasFalls: true },
  { hasMedications: true, hasFalls: false },
  { hasMedications: false, hasFalls: false },
])('약 변경·낙상 기록 없음 상태를 각각 표시한다 (%j)', async ({ hasMedications, hasFalls }) => {
  if (!hasMedications) data.medications = []
  if (!hasFalls) data.falls = []
  render(<SummaryPage health={{} as Health} active />)
  await ready()
  for (const section of document.querySelectorAll('.v2-medication-history')) {
    expect(section.textContent?.includes('이 기간에 약 변경 기록 없음')).toBe(!hasMedications)
    expect(section.querySelectorAll('li')).toHaveLength(hasMedications ? 1 : 0)
  }
  for (const section of document.querySelectorAll('.v2-fall-history')) {
    expect(section.textContent?.includes('이 기간에 확인된 낙상 기록 없음')).toBe(!hasFalls)
    expect(section.querySelectorAll('li')).toHaveLength(hasFalls ? 1 : 0)
  }
})
it('인쇄는 계산된 요약·비율을 그대로 보존하고 근거 날짜와 원문을 제외한다', async () => {
  render(<SummaryPage health={{} as Health} active />)
  await ready()
  const paper = printContent()
  expect(paper.querySelector('.v2-core-summary li')?.textContent).toBe(data.sentences[0].text)
  expect(paper.textContent).not.toContain('근거 작성일')
  expect(paper.textContent).not.toContain('2026-09-22')
  expect(paper.textContent).not.toContain(source().text)
  expect(paper.querySelector('thead')?.textContent).toBe('유형기준 구간이번 구간주당 환산표시')
  expect(paper.querySelector('tbody')?.textContent).toContain('3.5회')
})
it('인쇄본은 UI·모바일 카드·근거 패널을 숨기고 인쇄 버튼은 클릭에서 바로 실행한다', async () => {
  render(<SummaryPage health={{} as Health} active />)
  await ready()
  const style = applyPrintStyles()
  expect(getComputedStyle(document.querySelector('.mvp-summary-ui')!).display).toBe('none')
  expect(getComputedStyle(printContent()).visibility).toBe('visible')
  expect(getComputedStyle(document.querySelector('.v2-source-panel')!).display).toBe('none')
  style.remove()
  fireEvent.click(printButton())
  expect(window.print).toHaveBeenCalledOnce()
})
it('화면에서 요약 문장을 누르면 PC 오른쪽에 선택한 날짜와 강조한 원문을 표시한다', async () => {
  render(<SummaryPage health={{} as Health} active />)
  await ready()
  const preview = screen.getByRole('region', { name: 'A4 요약지 미리보기' })
  fireEvent.click(within(preview).getAllByRole('button', { name: '야간 각성 관련 기록 보기' })[0])
  const panel = screen.getByRole('complementary', { name: '근거 원문' })
  await waitFor(() => expect(panel.textContent).toContain(source().text))
  expect(panel.querySelector('.v2-source-date')?.textContent).toBe('9월 22일')
  expect(panel.querySelector('.v2-source-date time')?.getAttribute('datetime')).toBe('2026-09-22')
  expect(panel.querySelector('mark')?.textContent).toBe(source().events[0].evidence)
})
it('모바일은 유형별 카드와 전체 폭 그래프를 제공하고 근거를 하단 시트로 연다', async () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  )
  render(<SummaryPage health={{} as Health} active />)
  await ready()
  const mobileRules = Array.from(stylesheet.sheet!.cssRules)
    .filter(
      (rule): rule is CSSMediaRule =>
        'media' in rule &&
        (rule as CSSMediaRule).media.mediaText.replace(/\s/g, '') === '(max-width:760px)',
    )
    .flatMap((rule) => Array.from(rule.cssRules).map((child) => child.cssText))
    .join('\n')
  stylesheet.textContent += mobileRules
  const mobile = document.querySelector('.v2-mobile-summary')! as HTMLElement
  expect(mobile.querySelector('table')).toBeNull()
  expect(mobile.querySelector('.v2-report-chart')).toBeTruthy()
  fireEvent.click(within(mobile).getByRole('button', { name: /야간 각성.*증가/ }))
  const dialog = screen.getByRole('dialog', { name: '야간 각성 관련 기록' })
  expect(dialog.classList.contains('v2-source-sheet')).toBe(true)
  fireEvent.click(within(dialog).getByRole('button', { name: '닫기' }))
  expect((dialog as HTMLDialogElement).open).toBe(false)
})
it('처음에는 원문 세 건만 보여 주고 나머지를 이어서 확인한다', async () => {
  const memos = [1, 2, 3, 4, 5].map(source)
  api.memos.mockResolvedValue(memos)
  data.sentences[0].memo_ids = [1, 2, 3, 4, 5]
  render(<SummaryPage health={{} as Health} active />)
  await ready()
  const panel = screen.getByRole('complementary', { name: '근거 원문' })
  await waitFor(() => expect(panel.querySelectorAll('article')).toHaveLength(3))
  fireEvent.click(within(panel).getByRole('button', { name: '나머지 2건 더 보기' }))
  expect(panel.querySelectorAll('article')).toHaveLength(5)
})
it('모바일 원문을 연 뒤 다른 탭으로 이동하면 닫고 완료 요약은 재진입에서 재사용한다', async () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  )
  const view = render(<SummaryPage health={{} as Health} active />)
  await ready()
  const preview = screen.getByRole('region', { name: 'A4 요약지 미리보기' })
  fireEvent.click(within(preview).getAllByRole('button', { name: '야간 각성 관련 기록 보기' })[0])
  const sheet = document.querySelector('.v2-source-sheet') as HTMLDialogElement
  await waitFor(() => expect(sheet.open).toBe(true))
  view.rerender(<SummaryPage health={{} as Health} active={false} />)
  expect(sheet.open).toBe(false)
  expect(printButton().disabled).toBe(true)
  view.rerender(<SummaryPage health={{} as Health} active />)
  await ready()
  expect(api.summary).toHaveBeenCalledOnce()
  expect(sheet.open).toBe(false)
})
it('한 장이 넘치면 표시 없는 양쪽 0% 유형만 상세 장으로 옮기고 내용을 버리지 않는다', async () => {
  data.rows.push({
    ...data.rows[0],
    type: '우울·무기력',
    baseline_rate: 0,
    current_rate: 0,
    occurrence_days: 0,
    baseline_occurrence_days: 0,
    mark: null,
  })
  coreOverflows = true
  render(<SummaryPage health={{} as Health} active />)
  await ready()
  const paper = printContent()
  expect(paper.querySelector('.v2-page-core tbody')?.textContent).not.toContain('우울·무기력')
  expect(paper.querySelector('.v2-page-detail tbody')?.textContent).toContain('우울·무기력')
  expect(paper.querySelectorAll('tbody tr')).toHaveLength(2)
})
it('긴 질문·약 이름·요약은 자르지 않고 추가 인쇄 페이지로 이어질 수 있도록 보존한다', async () => {
  const originalQuestion = '질문 내용입니다.\n\n'.repeat(90)
  const originalMedication = '약 이름 '.repeat(100)
  data.questions = [originalQuestion]
  data.medications[0].name = originalMedication
  render(<SummaryPage health={{} as Health} active />)
  await ready()
  const paper = printContent()
  expect(paper.querySelector('.v2-questions li')?.textContent).toBe(originalQuestion)
  expect(paper.querySelector('.v2-medication-history li>span')?.textContent).toContain(
    originalMedication,
  )
  expect(screen.queryByText(/요약 기간을 줄여/)).toBeNull()
  const style = applyPrintStyles()
  const front = paper.querySelector('.v2-page-core')!
  expect(getComputedStyle(front).overflow).toBe('visible')
  expect(getComputedStyle(front).height).toBe('auto')
  style.remove()
})
it('질문이 없어도 출력하며 빈 질문 상태를 명시한다', async () => {
  data.questions = []
  render(<SummaryPage health={{} as Health} active />)
  await ready()
  expect(printContent().querySelector('.v2-questions')?.textContent).toContain('등록한 질문 없음')
})
it('미확인·실패 기록이 있으면 제외 내용을 확인한 뒤에만 출력한다', async () => {
  setHash('#summary?as_of=2026-09-27&period_start=2026-08-20')
  data.exclusions = {
    pending_memo_ids: [9],
    failed_memo_ids: [10],
  }
  render(<SummaryPage health={{} as Health} active />)
  await ready()
  fireEvent.click(printButton())
  expect(window.print).not.toHaveBeenCalled()
  const dialog = screen.getByRole('dialog', { name: '출력 전 기록 확인' })
  for (const name of ['확인 대기 메모 9번 열기', '정리 실패 메모 10번 열기']) {
    const href = within(dialog).getByRole('link', { name }).getAttribute('href')!
    expect(href).toContain('return_to=summary-print')
    expect(href).toContain('as_of=2026-09-27')
    expect(href).toContain('period_start=2026-08-20')
  }
  const listHref = within(dialog)
    .getByRole('link', { name: '기록 확인하러 가기' })
    .getAttribute('href')!
  expect(listHref).toContain('view=history')
  expect(listHref).not.toContain('return_to')
  fireEvent.click(within(dialog).getByRole('button', { name: '확인된 기록만 출력' }))
  expect(window.print).toHaveBeenCalledOnce()
  expect(printContent().textContent).not.toMatch(/집계 제외|확인 대기 메모|정리 실패 메모/)
  fireEvent(window, new Event('afterprint'))
  api.summary.mockResolvedValueOnce({ ...data })
  fireEvent.click(screen.getByRole('button', { name: '새로 불러오기' }))
  await ready()
  fireEvent.click(printButton())
  expect(screen.getByRole('dialog', { name: '출력 전 기록 확인' })).toBeTruthy()
  expect(window.print).toHaveBeenCalledOnce()
})
it('출력 팝업 밖의 제외 기록 링크는 기본 기록 상세 동선을 유지한다', () => {
  data.exclusions = { pending_memo_ids: [9], failed_memo_ids: [] }
  render(<ExcludedRecords data={data} expanded />)
  const href = screen.getByRole('link', { name: '확인 대기 메모 9번 열기' }).getAttribute('href')!
  expect(href).toContain('memo=9')
  expect(href).not.toContain('return_to')
})
it('제외 기록 처리 후 돌아오면 최신 요약 준비를 기다려 출력 확인을 재개하고 닫은 뒤 재방문에는 열지 않는다', async () => {
  data.exclusions = { pending_memo_ids: [9], failed_memo_ids: [10] }
  setHash('#summary?as_of=2026-09-27&period_start=2026-08-20')
  const mounted = render(<SummaryPage health={{} as Health} active />)
  await ready()
  fireEvent.click(printButton())
  const initial = within(screen.getByRole('dialog', { name: '출력 전 기록 확인' }))
  const recordHref = initial
    .getByRole('link', { name: '확인 대기 메모 9번 열기' })
    .getAttribute('href')!
  act(() => setHash(recordHref))
  mounted.rerender(<SummaryPage health={{} as Health} active={false} />)
  let finish!: (value: Summary) => void
  api.summary.mockReturnValueOnce(
    new Promise<Summary>((resolve) => {
      finish = resolve
    }),
  )
  act(() => window.dispatchEvent(new Event('itda-final-updated')))
  act(() => setHash('#summary?review=print&as_of=2026-09-27&period_start=2026-08-20'))
  mounted.rerender(<SummaryPage health={{} as Health} active />)
  expect(screen.queryByRole('dialog', { name: '출력 전 기록 확인' })).toBeNull()
  expect(printButton().disabled).toBe(true)
  expect(window.location.hash).toContain('review=print')
  expect(window.print).not.toHaveBeenCalled()
  const fresh = { ...data, exclusions: { pending_memo_ids: [], failed_memo_ids: [10] } }
  await act(async () => finish(fresh))
  const resumed = within(await screen.findByRole('dialog', { name: '출력 전 기록 확인' }))
  expect(resumed.queryByRole('link', { name: '확인 대기 메모 9번 열기' })).toBeNull()
  expect(resumed.getByRole('link', { name: '정리 실패 메모 10번 열기' })).toBeTruthy()
  expect(window.location.hash).not.toContain('review=print')
  expect(window.location.hash).toContain('as_of=2026-09-27')
  expect(window.location.hash).toContain('period_start=2026-08-20')
  expect(api.summary).toHaveBeenLastCalledWith('2026-09-27', '2026-08-20', true)
  expect(window.print).not.toHaveBeenCalled()
  fireEvent.click(resumed.getByRole('button', { name: '닫기', exact: true }))
  act(() => setHash('#record?as_of=2026-09-27&period_start=2026-08-20'))
  mounted.rerender(<SummaryPage health={{} as Health} active={false} />)
  act(() => setHash('#summary?as_of=2026-09-27&period_start=2026-08-20'))
  mounted.rerender(<SummaryPage health={{} as Health} active />)
  await ready()
  expect(screen.queryByRole('dialog', { name: '출력 전 기록 확인' })).toBeNull()
  expect(api.summary).toHaveBeenCalledTimes(2)
  expect(window.print).not.toHaveBeenCalled()
})
it('출력 확인 복귀의 요약 조회가 실패하면 재시도할 때까지 요청을 유지하고 회복 후 재개한다', async () => {
  data.exclusions = { pending_memo_ids: [], failed_memo_ids: [10] }
  api.summary.mockRejectedValueOnce(new Error('최신 요약 조회 실패')).mockResolvedValue(data)
  setHash('#summary?review=print&as_of=2026-09-27&period_start=2026-08-20')
  render(<SummaryPage health={{} as Health} active />)
  const error = within(await screen.findByRole('alertdialog', { name: '불러오지 못했어요' }))
  expect(error.getByText('최신 요약 조회 실패')).toBeTruthy()
  expect(screen.queryByRole('dialog', { name: '출력 전 기록 확인' })).toBeNull()
  expect(window.location.hash).toContain('review=print')
  expect(printButton().disabled).toBe(true)
  expect(window.print).not.toHaveBeenCalled()
  fireEvent.click(error.getByRole('button', { name: '다시 불러오기' }))
  const resumed = within(await screen.findByRole('dialog', { name: '출력 전 기록 확인' }))
  expect(resumed.getByRole('link', { name: '정리 실패 메모 10번 열기' })).toBeTruthy()
  expect(window.location.hash).not.toContain('review=print')
  expect(api.summary).toHaveBeenCalledTimes(2)
  expect(window.print).not.toHaveBeenCalled()
})
it('마지막 제외 기록을 처리한 복귀도 빈 확인 팝업에서 사용자가 PDF로 저장을 눌러야 인쇄한다', async () => {
  data.exclusions = { pending_memo_ids: [], failed_memo_ids: [] }
  setHash('#summary?review=print&as_of=2026-09-27&period_start=2026-08-20')
  render(<SummaryPage health={{} as Health} active />)
  const resumed = within(await screen.findByRole('dialog', { name: '출력 전 기록 확인' }))
  expect(resumed.getByText('확인할 기록이 없어요.')).toBeTruthy()
  expect(resumed.queryByRole('link', { name: '기록 확인하러 가기' })).toBeNull()
  expect(resumed.queryByRole('button', { name: '확인된 기록만 출력' })).toBeNull()
  expect(window.print).not.toHaveBeenCalled()
  expect(window.location.hash).not.toContain('review=print')
  fireEvent.click(resumed.getByRole('button', { name: 'PDF로 저장' }))
  expect(window.print).toHaveBeenCalledOnce()
  expect(screen.queryByRole('dialog', { name: '출력 전 기록 확인' })).toBeNull()
  expect(window.location.hash).toContain('as_of=2026-09-27')
  expect(window.location.hash).toContain('period_start=2026-08-20')
})
it('새 요청 진행 중과 실패 시에는 이전 요약을 인쇄하지 않는다', async () => {
  render(<SummaryPage health={{} as Health} active />)
  await ready()
  let fail!: (value: Error) => void
  api.summary.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      fail = reject
    }),
  )
  fireEvent.click(screen.getByRole('button', { name: '새로 불러오기' }))
  expect(document.querySelector('.v2-print-copy')).toBeNull()
  expect(printButton().disabled).toBe(true)
  await act(async () => fail(new Error('연결 실패')))
  expect(screen.getByRole('alertdialog').textContent).toContain('연결 실패')
  expect(document.querySelector('.v2-print-copy')).toBeNull()
})
it('근거 원문 조회 실패는 패널에 재시도를 표시하며 원문을 쓰지 않는 인쇄본은 유지한다', async () => {
  api.memos.mockRejectedValue(new Error('원문 요청 실패'))
  render(<SummaryPage health={{} as Health} active />)
  await ready()
  const panel = screen.getByRole('complementary', { name: '근거 원문' })
  expect((await within(panel).findByRole('alert')).textContent).toContain(
    '근거 원문을 불러오지 못했어요',
  )
  expect(within(panel).getByRole('button', { name: '다시 불러오기' })).toBeTruthy()
})
it('글꼴 준비 전에는 인쇄를 막는다', async () => {
  let finish!: () => void
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      ready: new Promise<void>((resolve) => {
        finish = resolve
      }),
    },
  })
  render(<SummaryPage health={{} as Health} active />)
  await waitFor(() => expect(document.querySelector('.v2-print-copy')).not.toBeNull())
  expect(printButton().disabled).toBe(true)
  await act(async () => finish())
  await ready()
})
it('인쇄 호출이 실패하거나 창이 안 뜨면 현재 주소를 복사할 수 있다', async () => {
  vi.mocked(window.print).mockImplementation(() => {
    throw new Error('blocked')
  })
  render(<SummaryPage health={{} as Health} active />)
  await ready()
  fireEvent.click(printButton())
  expect(screen.getByRole('alert').textContent).toContain('이 창에서 인쇄를 시작하지 못했어요')
  fireEvent.click(screen.getByRole('button', { name: '주소 복사' }))
  await waitFor(() =>
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(window.location.href),
  )
  fireEvent(window, new Event('afterprint'))
  expect(screen.queryByRole('button', { name: '주소 복사' })).toBeNull()
})
it('선택한 기간을 AI 요약에도 전달하고 적용 전에는 기존 결과를 유지한다', async () => {
  render(<SummaryPage health={{} as Health} active />)
  await ready()
  api.summary.mockClear()
  fireEvent.change(screen.getByLabelText('시작 날짜'), { target: { value: '2026-09-01' } })
  expect(api.summary).not.toHaveBeenCalled()
  await waitFor(() =>
    expect(api.summary).toHaveBeenCalledExactlyOnceWith('2026-09-27', '2026-09-01', true),
  )
})
it('구 응답의 그래프 선정도 감소를 포함한 절댓값 차이순 세 개이며 양쪽 발생일 3일 미만은 제외한다', () => {
  data.rows = [
    {
      ...data.rows[0],
      type: '야간 각성',
      baseline_rate: 0.1,
      current_rate: 0.2,
      occurrence_days: 6,
    },
    {
      ...data.rows[0],
      type: '초조·공격',
      baseline_rate: 0.9,
      current_rate: 0.1,
      occurrence_days: 3,
    },
    { ...data.rows[0], type: '불안', baseline_rate: 0.1, current_rate: 0.8, occurrence_days: 24 },
    { ...data.rows[0], type: '망상', baseline_rate: 0, current_rate: 0.5, occurrence_days: 15 },
    {
      ...data.rows[0],
      type: '환각',
      baseline_rate: 0,
      current_rate: 0.9,
      occurrence_days: 2,
      baseline_occurrence_days: 0,
    },
  ]
  expect(summaryTrendTypes(data)).toEqual(['초조·공격', '불안', '망상'])
})

it('기간을 바꾸면 이전 원문을 숨기고 새 원문 응답만 표시한다', async () => {
  render(<SummaryPage health={{} as Health} active />)
  await ready()
  const panel = screen.getByRole('complementary', { name: '근거 원문' })
  await waitFor(() => expect(panel.textContent).toContain(source().text))
  let finish!: (value: MemoResult[]) => void
  const updated = { ...data, period: { ...data.period, end: '2026-09-26' } }
  api.summary.mockResolvedValueOnce(updated)
  api.memos.mockReturnValueOnce(
    new Promise<MemoResult[]>((resolve) => {
      finish = resolve
    }),
  )
  await act(async () => setHash('#summary?as_of=2026-09-26'))
  const nextPanel = await screen.findByRole('complementary', { name: '근거 원문' })
  expect(nextPanel.textContent).not.toContain(source().text)
  expect(within(nextPanel).getByRole('status').textContent).toContain('근거 원문을 불러오고 있어요')
  const fresh = {
    ...source(),
    text: '새 기간에 확인한 원문',
    events: [{ ...source().events[0], evidence: '새 기간에 확인한 원문' }],
  }
  await act(async () => finish([fresh]))
  await waitFor(() => expect(nextPanel.textContent).toContain(fresh.text))
  expect(nextPanel.textContent).not.toContain(source().text)
})
it('발생 근거는 확정한 같은 유형만 연결하고 없었음·이전 구간을 구분한다', async () => {
  const happened = source(1)
  const absent = {
    ...source(2),
    text: '오늘은 밤에 깨지 않으셨다.',
    events: [
      {
        ...source().events[0],
        status: '없었음' as const,
        evidence: '오늘은 밤에 깨지 않으셨다.',
      },
    ],
  }
  const pending = { ...source(3), status: '확인 대기' as const, text: '확인하지 않은 문장' }
  const unrelated = {
    ...source(4),
    text: '별개의 낙상 원문',
    events: [{ ...source().events[0], type: '낙상' as const, evidence: '별개의 낙상 원문' }],
  }
  const baseline = {
    ...source(5),
    record_date: '2026-06-10',
    text: '이전 구간에서 밤에 깬 원문',
    events: [{ ...source().events[0], evidence: '이전 구간에서 밤에 깬 원문' }],
  }
  data.sentences[0].memo_ids = [1, 2, 3, 4, 5]
  api.memos.mockResolvedValue([happened, absent, pending, unrelated, baseline])
  render(<SummaryPage health={{} as Health} active />)
  await ready()
  const panel = screen.getByRole('complementary', { name: '근거 원문' })
  await waitFor(() => expect(panel.querySelectorAll('article')).toHaveLength(3))
  expect(panel.querySelector('article')?.textContent).toContain(happened.text)
  expect(panel.textContent).toContain('없었다고 적은 기록')
  expect(panel.textContent).toContain('이전 기간의 기록')
  expect(panel.textContent).not.toContain(pending.text)
  expect(panel.textContent).not.toContain(unrelated.text)
})
it('나중에 저장한 과거 기록과 사건 없는 메모도 선택한 날짜로만 커버리지 근거에 포함한다', async () => {
  const retrospective = {
    ...source(1),
    record_date: '2026-06-03',
    created_at: '2026-09-27T10:00:00',
    text: '6월 3일 밤에 깨셨다.',
    events: [{ ...source().events[0], evidence: '6월 3일 밤에 깨셨다.' }],
  }
  const everyday = {
    ...source(2),
    record_date: '2026-06-02',
    text: '가족과 사진을 보았다.',
    events: [],
  }
  const outside = { ...source(3), record_date: '2026-09-27', text: '이번 기간만 있는 메모' }
  data.sentences = [
    {
      text: '기준 구간 전체 91일 중 2일에 확인된 기록이 있음.',
      types: [],
      evidence_dates: ['2026-06-02', '2026-06-03'],
      memo_ids: [1, 2, 3],
    },
  ]
  api.memos.mockResolvedValue([retrospective, everyday, outside])
  render(<SummaryPage health={{} as Health} active />)
  await ready()
  const panel = screen.getByRole('complementary', { name: '근거 원문' })
  await waitFor(() => expect(panel.querySelectorAll('article')).toHaveLength(2))
  expect(panel.querySelector('.v2-source-date')?.textContent).toBe('6월 3일')
  expect(panel.textContent).not.toContain('9월 27일')
  expect(panel.textContent).toContain(everyday.text)
  expect(panel.textContent).not.toContain(outside.text)
})
it('증가 없음의 통합 근거도 기준·이번 구간의 확인된 일상 메모를 모두 연결한다', async () => {
  const previous = {
    ...source(1),
    record_date: '2026-06-01',
    events: [],
    text: '이전 기간의 일상 기록',
  }
  const current = {
    ...source(2),
    record_date: '2026-09-09',
    events: [],
    text: '이번 기간의 일상 기록',
  }
  data.sentences = [
    {
      text: '기준 구간 대비 증가 표시가 붙은 항목 없음. 전체 39일 중 1일에 확인된 기록이 있음.',
      types: [],
      evidence_dates: ['2026-06-01', '2026-09-09'],
      memo_ids: [1, 2],
    },
  ]
  api.memos.mockResolvedValue([previous, current])
  render(<SummaryPage health={{} as Health} active />)
  await ready()
  const panel = screen.getByRole('complementary', { name: '근거 원문' })
  await waitFor(() => expect(panel.querySelectorAll('article')).toHaveLength(2))
  expect(panel.textContent).toContain(previous.text)
  expect(panel.textContent).toContain(current.text)
})
it('아주 긴 원문도 근거 패널에는 모두 보존하고 인쇄에는 복제하지 않는다', async () => {
  const original = '밤에 깬 뒤 거실에서 잠시 함께 앉아 있었다.\n'.repeat(100)
  const memo = {
    ...source(),
    text: original,
    events: [{ ...source().events[0], evidence: original }],
  }
  api.memos.mockResolvedValue([memo])
  render(<SummaryPage health={{} as Health} active />)
  await ready()
  const panel = screen.getByRole('complementary', { name: '근거 원문' })
  await waitFor(() => expect(panel.querySelector('.v2-source-text')?.textContent).toBe(original))
  expect(printContent().textContent).not.toContain(original)
})

it.each([
  {
    scope: 'baseline' as const,
    text: '이전 진료 구간에는 이틀의 기록이 있습니다.',
    expected: ['이전 기간 일상 메모'],
    excluded: ['이번 기간 일상 메모'],
  },
  {
    scope: 'comparison' as const,
    text: '두 진료 구간의 기록을 함께 비교했습니다.',
    expected: ['이전 기간 일상 메모', '이번 기간 일상 메모'],
    excluded: [],
  },
  {
    scope: 'current' as const,
    text: '기준 구간 전체 기록과 달리 이번에는 하루 기록이 있습니다.',
    expected: ['이번 기간 일상 메모'],
    excluded: ['이전 기간 일상 메모'],
  },
])(
  'AI 문장 표현과 무관하게 서버 scope=$scope로 근거 기간을 결정한다',
  async ({ scope, text, expected, excluded }) => {
    const previous = {
      ...source(1),
      record_date: '2026-06-01',
      events: [],
      text: '이전 기간 일상 메모',
    }
    const current = {
      ...source(2),
      record_date: '2026-09-09',
      events: [],
      text: '이번 기간 일상 메모',
    }
    data.sentences = [
      { text, scope, types: [], evidence_dates: ['2026-06-01', '2026-09-09'], memo_ids: [1, 2] },
    ]
    api.memos.mockResolvedValue([previous, current])
    render(<SummaryPage health={{} as Health} active />)
    await ready()
    const panel = screen.getByRole('complementary', { name: '근거 원문' })
    await waitFor(() => expect(panel.querySelectorAll('article')).toHaveLength(expected.length))
    for (const value of expected) expect(panel.textContent).toContain(value)
    for (const value of excluded) expect(panel.textContent).not.toContain(value)
  },
)
it('기준 구간이 없는 comparison 근거는 이번 구간만 사용한다', async () => {
  data.baseline = null
  data.sentences = [
    {
      text: '처음 기록한 기간입니다.',
      scope: 'comparison',
      types: [],
      evidence_dates: ['2026-06-01', '2026-09-09'],
      memo_ids: [1, 2],
    },
  ]
  api.memos.mockResolvedValue([
    { ...source(1), record_date: '2026-06-01', events: [], text: '범위 밖 일상 메모' },
    { ...source(2), record_date: '2026-09-09', events: [], text: '이번 기간 일상 메모' },
  ])
  render(<SummaryPage health={{} as Health} active />)
  await ready()
  const panel = screen.getByRole('complementary', { name: '근거 원문' })
  await waitFor(() => expect(panel.querySelectorAll('article')).toHaveLength(1))
  expect(panel.textContent).toContain('이번 기간 일상 메모')
  expect(panel.textContent).not.toContain('범위 밖 일상 메모')
})

it('근거 재시도는 선택한 원문만 다시 불러오고 완료된 AI 요약을 재생성하지 않는다', async () => {
  api.memos.mockRejectedValueOnce(new Error('원문 일시 오류')).mockResolvedValue([source()])
  render(<SummaryPage health={{} as Health} active />)
  await ready()
  const panel = screen.getByRole('complementary', { name: '근거 원문' })
  fireEvent.click(within(panel).getByRole('button', { name: '다시 불러오기' }))
  await waitFor(() =>
    expect(panel.querySelector('.v2-source-text')?.textContent).toBe(source().text),
  )
  expect(api.memos).toHaveBeenCalledTimes(2)
  expect(api.summary).toHaveBeenCalledTimes(1)
  expect(printButton().disabled).toBe(false)
})
it('구 응답의 그래프 실패도 요약을 다시 생성하지 않고 그래프만 재시도한다', async () => {
  delete data.trends
  const recovered: Trends = {
    type: '야간 각성',
    period: data.period,
    baseline: data.baseline,
    weeks: [],
    medications: [],
  }
  api.trends.mockRejectedValueOnce(new Error('그래프 오류')).mockResolvedValue(recovered)
  render(<SummaryPage health={{} as Health} active />)
  await ready()
  const notice = screen.getByText('일부 주간 추이를 불러오지 못했어요.', { exact: false })
  fireEvent.click(within(notice).getByRole('button', { name: '다시 불러오기' }))
  await waitFor(() =>
    expect(screen.queryByText('일부 주간 추이를 불러오지 못했어요.', { exact: false })).toBeNull(),
  )
  await ready()
  expect(api.summary).toHaveBeenCalledTimes(1)
  expect(api.trends).toHaveBeenCalledTimes(2)
  expect(printContent().querySelectorAll('.v2-report-chart')).toHaveLength(1)
})
it('요약 실패 팝업을 닫아도 재시도할 수 있고 같은 실패가 다시 나면 팝업을 보여준다', async () => {
  api.summary
    .mockRejectedValueOnce(new Error('일시적인 조회 실패'))
    .mockRejectedValueOnce(new Error('일시적인 조회 실패'))
    .mockResolvedValue(data)
  render(<SummaryPage health={{} as Health} active />)
  let dialog = await screen.findByRole('alertdialog')
  expect(dialog.textContent).toContain('일시적인 조회 실패')
  fireEvent.click(within(dialog).getByRole('button', { name: '확인' }))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
  dialog = await screen.findByRole('alertdialog')
  fireEvent.click(within(dialog).getByRole('button', { name: '다시 불러오기' }))
  await ready()
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(api.summary).toHaveBeenCalledTimes(3)
})
it('인쇄·복사 결과는 팝업 안에 표시하고 복사 실패 후 주소를 직접 선택할 수 있다', async () => {
  vi.mocked(navigator.clipboard.writeText)
    .mockRejectedValueOnce(new Error('권한 없음'))
    .mockResolvedValue(undefined)
  render(<SummaryPage health={{} as Health} active />)
  await ready()
  fireEvent.click(printButton())
  const dialog = screen.getByRole('dialog', { name: 'PDF 저장 안내' })
  fireEvent.click(within(dialog).getByRole('button', { name: '주소 복사' }))
  await waitFor(() =>
    expect(within(dialog).getByRole('status').textContent).toContain(
      '주소를 자동으로 복사하지 못했어요',
    ),
  )
  expect((within(dialog).getByLabelText('현재 주소') as HTMLInputElement).value).toBe(
    window.location.href,
  )
  fireEvent.click(within(dialog).getByRole('button', { name: '주소 복사' }))
  await waitFor(() =>
    expect(within(dialog).getByRole('status').textContent).toContain('주소를 복사했어요'),
  )
  fireEvent.click(within(dialog).getByRole('button', { name: '확인' }))
  expect(screen.queryByRole('dialog', { name: 'PDF 저장 안내' })).toBeNull()
})
it('인쇄 도움말에서 나간 후 늦게 끝난 복사는 재진입 화면에 팝업을 띄우지 않는다', async () => {
  let finish!: () => void
  vi.mocked(navigator.clipboard.writeText).mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve
    }),
  )
  const view = render(<SummaryPage health={{} as Health} active />)
  await ready()
  fireEvent.click(printButton())
  fireEvent.click(screen.getByRole('button', { name: '주소 복사' }))
  view.rerender(<SummaryPage health={{} as Health} active={false} />)
  await act(async () => finish())
  expect(screen.queryByRole('dialog')).toBeNull()
  view.rerender(<SummaryPage health={{} as Health} active />)
  await ready()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(api.summary).toHaveBeenCalledTimes(1)
})

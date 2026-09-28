import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PeriodControls } from '../src/shared/report/PeriodControls'

const setPeriod = vi.fn()
const resetPeriod = vi.fn()
const initial = {
  asOf: '2026-09-27',
  periodStart: null,
  defaultStart: '2026-08-20',
  setPeriod,
  resetPeriod,
  active: true,
}
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
const settle = () => act(async () => vi.advanceTimersByTimeAsync(500))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 28, 12))
  setPeriod.mockClear()
  resetPeriod.mockClear()
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
})

it('기본 기간은 별도 적용 동작이나 중복 조회 없이 바로 표시한다', async () => {
  render(<PeriodControls {...initial} />)
  expect((screen.getByLabelText('시작 날짜') as HTMLInputElement).value).toBe('2026-08-20')
  expect(screen.queryByRole('button', { name: '이 기간으로 보기' })).toBeNull()
  await settle()
  expect(setPeriod).not.toHaveBeenCalled()
})

it('두 날짜를 연속으로 고르면 완성된 마지막 범위만 자동 적용한다', async () => {
  render(<PeriodControls {...initial} />)
  change('시작 날짜', '2026-06-01')
  await act(async () => vi.advanceTimersByTimeAsync(200))
  change('마지막 날짜', '2026-06-30')
  expect(setPeriod).not.toHaveBeenCalled()
  await settle()
  expect(setPeriod).toHaveBeenCalledExactlyOnceWith({
    asOf: '2026-06-30',
    periodStart: '2026-06-01',
  })
})

it.each([
  { name: '시작 날짜', start: '2026-09-01', end: null },
  { name: '마지막 날짜', start: null, end: '2026-09-25' },
  { name: '두 날짜', start: '2026-09-01', end: '2026-09-25' },
])('기본 기간 응답이 늦게 도착해도 입력 중인 날짜를 보존한다 ($name)', async ({ start, end }) => {
  const view = render(<PeriodControls {...initial} defaultStart={undefined} />)
  if (start) change('시작 날짜', start)
  if (end) change('마지막 날짜', end)
  await act(async () => vi.advanceTimersByTimeAsync(200))

  view.rerender(<PeriodControls {...initial} />)

  expect((screen.getByLabelText('시작 날짜') as HTMLInputElement).value).toBe(
    start ?? initial.defaultStart,
  )
  expect((screen.getByLabelText('마지막 날짜') as HTMLInputElement).value).toBe(end ?? initial.asOf)
  await settle()
  expect(setPeriod).toHaveBeenCalledExactlyOnceWith({
    asOf: end ?? initial.asOf,
    periodStart: start ?? initial.defaultStart,
  })
})

it('입력하지 않은 기본 시작일은 진료일 변경으로 갱신되며 별도 기간을 적용하지 않는다', async () => {
  const view = render(<PeriodControls {...initial} />)
  view.rerender(<PeriodControls {...initial} defaultStart="2026-09-01" />)
  expect((screen.getByLabelText('시작 날짜') as HTMLInputElement).value).toBe('2026-09-01')
  await settle()
  expect(setPeriod).not.toHaveBeenCalled()
})

it('기본 시작일이 갱신되어도 사용자가 지운 날짜를 채우거나 기간을 적용하지 않는다', async () => {
  const view = render(<PeriodControls {...initial} />)
  change('시작 날짜', '')
  view.rerender(<PeriodControls {...initial} defaultStart="2026-09-01" />)
  expect((screen.getByLabelText('시작 날짜') as HTMLInputElement).value).toBe('')
  await settle()
  expect(setPeriod).not.toHaveBeenCalled()
})

it('빈 날짜·입력 중인 연도·역전 범위·미래 시작일은 보내지 않고 유효해지면 적용한다', async () => {
  render(<PeriodControls {...initial} />)
  for (const value of ['', '0002-09-01', '2026-09-28', '2027-01-01']) {
    change('시작 날짜', value)
    await settle()
    expect(setPeriod).not.toHaveBeenCalled()
  }
  change('시작 날짜', '2026-09-01')
  await settle()
  expect(setPeriod).toHaveBeenCalledExactlyOnceWith({
    asOf: '2026-09-27',
    periodStart: '2026-09-01',
  })
})

it('미래 마지막 날짜는 오늘로 바꾸고 보정한 날짜만 자동 적용한다', async () => {
  render(<PeriodControls {...initial} />)
  change('마지막 날짜', '9999-01-01')
  expect(screen.getByRole('dialog', { name: '기간을 확인해 주세요' }).textContent).toContain(
    '오늘(2026-09-28)',
  )
  await settle()
  expect(setPeriod).toHaveBeenCalledExactlyOnceWith({
    asOf: '2026-09-28',
    periodStart: '2026-08-20',
  })
})

it.each(['reset', 'inactive', 'navigation', 'unmount'] as const)(
  '날짜 변경 대기 중 %s 동작은 이전 입력의 적용을 취소한다',
  async (action) => {
    const view = render(<PeriodControls {...initial} isFixed />)
    change('시작 날짜', '2026-09-01')
    if (action === 'reset')
      fireEvent.click(screen.getByRole('button', { name: '기본 기간으로 돌아가기' }))
    else if (action === 'inactive') {
      view.rerender(<PeriodControls {...initial} active={false} />)
      view.rerender(<PeriodControls {...initial} />)
    } else if (action === 'navigation') {
      view.rerender(<PeriodControls {...initial} asOf="2026-08-31" periodStart="2026-08-01" />)
    } else view.unmount()
    await settle()
    expect(setPeriod).not.toHaveBeenCalled()
    if (action === 'reset') expect(resetPeriod).toHaveBeenCalledOnce()
  },
)

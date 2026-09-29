import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { reportHref, useReportSelection } from '../src/shared/lib/reportSelection'

function Probe() {
  const selection = useReportSelection()
  return (
    <>
      <output aria-label="요약 종료일">{selection.asOf}</output>
      <output aria-label="선택한 시작일">{selection.periodStart ?? '기본'}</output>
      <a href={reportHref('progress')}>경과</a>
      <button
        onClick={() => selection.setPeriod({ asOf: '2026-09-26', periodStart: '2026-08-20' })}
      >
        과거 선택
      </button>
      <button onClick={selection.resetPeriod}>기본으로</button>
    </>
  )
}
function navigate(hash: string) {
  window.history.replaceState(null, '', hash)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 27, 23, 59, 59))
  navigate('#summary')
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it('기본 조회는 주소에 날짜를 고정하지 않고 열린 화면에서도 자정 이후 오늘로 갱신한다', () => {
  render(<Probe />)
  expect(screen.getByLabelText('요약 종료일').textContent).toBe('2026-09-27')
  expect(window.location.hash).toBe('#summary')
  expect(screen.getByRole('link', { name: '경과' }).getAttribute('href')).toBe('#progress')
  act(() => {
    vi.advanceTimersByTime(1100)
  })
  expect(screen.getByLabelText('요약 종료일').textContent).toBe('2026-09-28')
  expect(window.location.hash).toBe('#summary')
})

it('오랫동안 닫아둔 탭을 다시 활성화하면 오늘까지 조회한다', () => {
  render(<Probe />)
  act(() => {
    vi.setSystemTime(new Date(2026, 8, 30, 10))
    window.dispatchEvent(new Event('focus'))
  })
  expect(screen.getByLabelText('요약 종료일').textContent).toBe('2026-09-30')
  expect(reportHref('schedule', { tab: 'questions' })).toBe('#schedule?tab=questions')
})

it('명시적으로 고른 과거 구간은 날짜가 바뀌어도 유지하며 기본 복귀로 종료일과 시작일을 함께 해제한다', () => {
  render(<Probe />)
  fireEvent.click(screen.getByRole('button', { name: '과거 선택' }))
  expect(window.location.hash).toBe('#summary?as_of=2026-09-26&period_start=2026-08-20')
  expect(reportHref('record', { memo: '7' })).toBe(
    '#record?memo=7&as_of=2026-09-26&period_start=2026-08-20',
  )
  act(() => {
    vi.advanceTimersByTime(1100)
  })
  expect(screen.getByLabelText('요약 종료일').textContent).toBe('2026-09-26')
  fireEvent.click(screen.getByRole('button', { name: '기본으로' }))
  expect(window.location.hash).toBe('#summary')
  expect(screen.getByLabelText('요약 종료일').textContent).toBe('2026-09-28')
  expect(screen.getByLabelText('선택한 시작일').textContent).toBe('기본')
})

it('기존 공유 주소의 종료일은 보존하고 메뉴 이동에서도 자동 날짜를 추가하지 않는다', () => {
  navigate('#summary?as_of=2026-09-20')
  render(<Probe />)
  expect(screen.getByLabelText('요약 종료일').textContent).toBe('2026-09-20')
  expect(reportHref('progress')).toBe('#progress?as_of=2026-09-20')
  act(() => navigate('#record'))
  expect(screen.getByLabelText('요약 종료일').textContent).toBe('2026-09-27')
  expect(reportHref('summary')).toBe('#summary')
})

it('유효하지 않은 종료일은 자동 오늘 조회로 복구한다', () => {
  navigate('#summary?as_of=2026-02-31')
  render(<Probe />)
  expect(screen.getByLabelText('요약 종료일').textContent).toBe('2026-09-27')
  expect(window.location.hash).toBe('#summary')
})

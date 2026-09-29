import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { Visit } from '../src/api/types'
import { useVisitPeriod } from '../src/shared/report'

const api = vi.hoisted(() => ({ visits: vi.fn() }))
vi.mock('../src/api', () => ({ api }))

const visit = (id: number, visit_date: string, status: Visit['status'] = '완료'): Visit => ({
  id,
  visit_date,
  status,
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 27, 12))
})
afterEach(() => {
  vi.useRealTimers()
})

it.each([
  ['진료일이 없으면 첫 기록일부터 오늘까지', [], { start: '2026-07-01', end: undefined }],
  [
    '다음 진료만 있으면 첫 기록부터 다음 진료일까지',
    [visit(1, '2026-10-05', '예정')],
    { start: '2026-07-01', end: '2026-10-05' },
  ],
  [
    '직전·다음 진료가 모두 있으면 직전 진료일부터 오늘까지',
    [visit(1, '2026-05-21'), visit(2, '2026-08-20'), visit(3, '2026-10-05', '예정')],
    { start: '2026-08-20', end: undefined },
  ],
  [
    '직전 진료만 있으면 직전 진료일부터 오늘까지',
    [visit(1, '2026-09-27')],
    { start: '2026-09-27', end: undefined },
  ],
] as const)('%s', async (_, visits, expected) => {
  api.visits.mockResolvedValue(visits)
  const { result } = renderHook(() => useVisitPeriod(true, '2026-07-01'))
  await waitFor(() => expect(api.visits).toHaveBeenCalled())
  await waitFor(() => expect(result.current).toEqual(expected))
})

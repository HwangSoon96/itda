import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useSummary } from '../src/shared/report'
import type { Summary } from '../src/api/types'

const api = vi.hoisted(() => ({ summary: vi.fn() }))
vi.mock('../src/api', () => ({ api }))

type Props = { asOf: string; active: boolean; start: string | null; ai: boolean }
const initial: Props = { asOf: '2026-09-27', active: true, start: null, ai: true }
const useReport = ({ asOf, active, start, ai }: Props) => useSummary(asOf, active, start, ai)
function fixture(label = '완료한 요약'): Summary {
  return {
    patient_alias: label,
    period: { start: '2026-08-20', end: '2026-09-27' },
    baseline: null,
    coverage: { recorded_days: 1, total_days: 39 },
    rows: [],
    sentences: [],
    medications: [],
    falls: [],
    questions: [],
    disclaimer: '보호자 관찰 기록',
    summary_source: 'llm',
    trends: [],
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function publish() {
  window.dispatchEvent(new Event('itda-final-updated'))
}
beforeEach(() => {
  vi.resetAllMocks()
  api.summary.mockResolvedValue(fixture())
})
afterEach(cleanup)

it('처음 숨겨진 요약지는 호출하지 않고 실제 열 때 한 번 불러온다', async () => {
  const { result, rerender } = renderHook(useReport, {
    initialProps: { ...initial, active: false },
  })
  expect(api.summary).not.toHaveBeenCalled()
  rerender(initial)
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(api.summary).toHaveBeenCalledExactlyOnceWith('2026-09-27', undefined, true)
})

it('완료한 요약지는 다른 탭에 다녀와도 즉시 재사용하고 다시 요청하지 않는다', async () => {
  const data = fixture()
  api.summary.mockResolvedValue(data)
  const { result, rerender } = renderHook(useReport, { initialProps: initial })
  await waitFor(() => expect(result.current.loading).toBe(false))
  rerender({ ...initial, active: false })
  rerender(initial)
  expect(result.current.loading).toBe(false)
  expect(result.current.data).toEqual(data)
  expect(api.summary).toHaveBeenCalledTimes(1)
})

it('정리 중 다른 탭에 다녀와도 같은 진행 중 요청을 이어받는다', async () => {
  const pending = deferred<Summary>()
  api.summary.mockReturnValue(pending.promise)
  const { result, rerender } = renderHook(useReport, { initialProps: initial })
  rerender({ ...initial, active: false })
  rerender(initial)
  expect(api.summary).toHaveBeenCalledTimes(1)
  await act(async () => pending.resolve(fixture('한 번만 정리함')))
  expect(result.current.loading).toBe(false)
  expect(result.current.data?.patient_alias).toBe('한 번만 정리함')
})

it('탭이 숨겨진 동안 완료된 요청도 다시 열 때 재사용한다', async () => {
  const pending = deferred<Summary>()
  api.summary.mockReturnValue(pending.promise)
  const { result, rerender } = renderHook(useReport, { initialProps: initial })
  rerender({ ...initial, active: false })
  await act(async () => pending.resolve(fixture('다른 탭에서 완료됨')))
  rerender(initial)
  expect(result.current.loading).toBe(false)
  expect(result.current.data?.patient_alias).toBe('다른 탭에서 완료됨')
  expect(api.summary).toHaveBeenCalledTimes(1)
})

it('시작일과 마지막 날로 기간을 구분하고 예전 기간으로 돌아오면 재사용한다', async () => {
  const a = fixture('기본 기간'),
    b = fixture('시작일 변경'),
    c = fixture('마지막 날 변경')
  api.summary.mockResolvedValueOnce(a).mockResolvedValueOnce(b).mockResolvedValueOnce(c)
  const { result, rerender } = renderHook(useReport, { initialProps: initial })
  await waitFor(() => expect(result.current.data).toEqual(a))
  const second = { ...initial, start: '2026-09-01' }
  rerender(second)
  await waitFor(() => expect(result.current.data).toEqual(b))
  rerender({ ...second, asOf: '2026-09-26' })
  await waitFor(() => expect(result.current.data).toEqual(c))
  rerender(initial)
  expect(result.current.loading).toBe(false)
  expect(result.current.data).toEqual(a)
  expect(api.summary.mock.calls).toEqual([
    ['2026-09-27', undefined, true],
    ['2026-09-27', '2026-09-01', true],
    ['2026-09-26', '2026-09-01', true],
  ])
})

it('문장 틀로 전환한 화면을 늦은 AI 결과가 덮지 않고 AI 결과도 별도로 보관한다', async () => {
  const pending = deferred<Summary>()
  const template = { ...fixture('빠른 문장 틀'), summary_source: 'template' as const }
  const ai = fixture('AI 완료')
  api.summary.mockImplementation((_end, _start, enabled) =>
    enabled ? pending.promise : Promise.resolve(template),
  )
  const { result, rerender } = renderHook(useReport, { initialProps: initial })
  rerender({ ...initial, ai: false })
  await waitFor(() => expect(result.current.data).toEqual(template))
  await act(async () => pending.resolve(ai))
  expect(result.current.data).toEqual(template)
  rerender(initial)
  expect(result.current.loading).toBe(false)
  expect(result.current.data).toEqual(ai)
  expect(api.summary).toHaveBeenCalledTimes(2)
})

it('AI 실패로 완성된 문장 틀도 완료 결과로 보관한다', async () => {
  const fallback = { ...fixture('문장 틀 완료'), summary_source: 'template' as const }
  api.summary.mockResolvedValue(fallback)
  const { result, rerender } = renderHook(useReport, { initialProps: initial })
  await waitFor(() => expect(result.current.loading).toBe(false))
  rerender({ ...initial, active: false })
  rerender(initial)
  expect(result.current.data).toEqual(fallback)
  expect(result.current.loading).toBe(false)
  expect(api.summary).toHaveBeenCalledTimes(1)
})

it('숨긴 동안 기록이 변경되면 예전 완료 결과를 폐기하고 다시 열 때 한 번 갱신한다', async () => {
  const original = fixture('변경 전'),
    updated = fixture('변경 후')
  api.summary.mockResolvedValueOnce(original).mockResolvedValueOnce(updated)
  const { result, rerender } = renderHook(useReport, { initialProps: initial })
  await waitFor(() => expect(result.current.data).toEqual(original))
  rerender({ ...initial, active: false })
  act(publish)
  expect(api.summary).toHaveBeenCalledTimes(1)
  rerender(initial)
  await waitFor(() => expect(result.current.data).toEqual(updated))
  expect(api.summary).toHaveBeenCalledTimes(2)
})

it('기록 변경은 보관한 모든 기간을 무효화한다', async () => {
  api.summary
    .mockResolvedValueOnce(fixture('이전 A'))
    .mockResolvedValueOnce(fixture('이전 B'))
    .mockResolvedValueOnce(fixture('새 B'))
    .mockResolvedValueOnce(fixture('새 A'))
  const { result, rerender } = renderHook(useReport, { initialProps: initial })
  await waitFor(() => expect(result.current.data?.patient_alias).toBe('이전 A'))
  rerender({ ...initial, start: '2026-09-01' })
  await waitFor(() => expect(result.current.data?.patient_alias).toBe('이전 B'))
  act(publish)
  await waitFor(() => expect(result.current.data?.patient_alias).toBe('새 B'))
  rerender(initial)
  await waitFor(() => expect(result.current.data?.patient_alias).toBe('새 A'))
  expect(api.summary).toHaveBeenCalledTimes(4)
})

it('기록 변경 전 시작한 늦은 요청은 새 요약이나 새 캐시를 덮지 않는다', async () => {
  const old = deferred<Summary>(),
    latest = deferred<Summary>()
  api.summary.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise)
  const { result, rerender } = renderHook(useReport, { initialProps: initial })
  act(publish)
  expect(api.summary).toHaveBeenCalledTimes(2)
  await act(async () => latest.resolve(fixture('최신 기록')))
  await act(async () => old.resolve(fixture('오래된 기록')))
  expect(result.current.data?.patient_alias).toBe('최신 기록')
  rerender({ ...initial, active: false })
  rerender(initial)
  expect(result.current.data?.patient_alias).toBe('최신 기록')
  expect(api.summary).toHaveBeenCalledTimes(2)
})

it('새로 불러오기는 완료 결과를 무효화하고 실제 재조회한다', async () => {
  api.summary
    .mockResolvedValueOnce(fixture('기존 완료'))
    .mockResolvedValueOnce(fixture('다시 조회한 완료'))
  const { result } = renderHook(useReport, { initialProps: initial })
  await waitFor(() => expect(result.current.loading).toBe(false))
  act(() => result.current.reload())
  await waitFor(() => expect(result.current.data?.patient_alias).toBe('다시 조회한 완료'))
  expect(api.summary).toHaveBeenCalledTimes(2)
})

it('실패한 요청은 다시 시도할 수 있고 오류가 새 완료 결과에 남지 않는다', async () => {
  api.summary
    .mockRejectedValueOnce(new Error('일시적인 연결 오류'))
    .mockResolvedValueOnce(fixture('복구됨'))
  const { result } = renderHook(useReport, { initialProps: initial })
  await waitFor(() => expect(result.current.error).toBe('일시적인 연결 오류'))
  expect(result.current.loading).toBe(false)
  act(() => result.current.reload())
  await waitFor(() => expect(result.current.data?.patient_alias).toBe('복구됨'))
  expect(result.current.error).toBe('')
  expect(result.current.loading).toBe(false)
  expect(api.summary).toHaveBeenCalledTimes(2)
})

it('다른 기록 공간을 여는 새 컴포넌트 인스턴스에 이전 결과를 넘기지 않는다', async () => {
  api.summary.mockResolvedValueOnce(fixture('공간 A')).mockResolvedValueOnce(fixture('공간 B'))
  const first = renderHook(useReport, { initialProps: initial })
  await waitFor(() => expect(first.result.current.data?.patient_alias).toBe('공간 A'))
  first.unmount()
  const second = renderHook(useReport, { initialProps: initial })
  expect(second.result.current.data).toBeNull()
  await waitFor(() => expect(second.result.current.data?.patient_alias).toBe('공간 B'))
  expect(api.summary).toHaveBeenCalledTimes(2)
})

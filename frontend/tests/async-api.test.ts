// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { adoptWorkspace, blockWorkspace } from '../src/api/client'
import type { ApiContract, HttpResponse, JobAdapter } from '../src/api/contract'
import { createHttpApi } from '../src/api/httpApi'
import { createRestContract } from '../src/api/restContract'
import type { MemoResult } from '../src/api/types'

const fetchMock = vi.fn()
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const memo: MemoResult = {
  memo_id: 41,
  text: '산책함',
  record_date: '2026-09-28',
  status: '확인 대기',
  events: [],
  emergency: { matched: false, message: null },
}
const job: JobAdapter = {
  read(response: HttpResponse) {
    if (!response.body || typeof response.body !== 'object') throw new Error('Bad task')
    const value = response.body as Record<string, unknown>
    if (response.status === 200 && !('state' in value)) return { state: 'complete', value }
    if (value.state === 'done') return { state: 'complete', value: value.result }
    if (value.state === 'error')
      return { state: 'failed', message: String(value.message), code: 'ai_unavailable' }
    if (value.state !== 'queued' && value.state !== 'running') throw new Error('Bad task state')
    if (typeof value.id !== 'string') throw new Error('Missing task ID')
    return {
      state: 'pending',
      request: { path: `/tasks/${encodeURIComponent(value.id)}` },
      retryAfterMs: 100,
    }
  },
}

function contract(timeoutMs = 1000): ApiContract {
  const value = createRestContract()
  value.endpoints.createMemo = {
    ...value.endpoints.createMemo,
    request: (body) => ({ path: '/observations', method: 'POST', body, timeoutMs }),
    job,
  }
  return value
}

beforeEach(() => {
  blockWorkspace()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_BASE_URL', '')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it('202 작업 접수 후 조회만 반복하고 완료된 데이터만 화면으로 돌려준다', async () => {
  vi.useFakeTimers()
  fetchMock
    .mockResolvedValueOnce(json({ state: 'queued', id: 'ai-1' }, 202))
    .mockResolvedValueOnce(json({ state: 'running', id: 'ai-1' }))
    .mockResolvedValueOnce(json({ state: 'done', result: memo }))
  const value = contract()
  const decode = vi.fn(value.endpoints.createMemo.decode)
  value.endpoints.createMemo.decode = decode
  const api = createHttpApi(value, { baseUrl: '/api' })
  const saved = api.createMemo({
    text: memo.text,
    record_date: memo.record_date,
    request_id: 'same-request',
  })
  await vi.advanceTimersByTimeAsync(100)
  expect(decode).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(100)
  await expect(saved).resolves.toEqual(memo)
  expect(decode).toHaveBeenCalledExactlyOnceWith(memo)
  expect(fetchMock.mock.calls.map(([path, request]) => [path, request.method])).toEqual([
    ['/api/observations', 'POST'],
    ['/api/tasks/ai-1', 'GET'],
    ['/api/tasks/ai-1', 'GET'],
  ])
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).request_id).toBe('same-request')
})

it('동기 완료도 같은 화면 반환 타입으로 처리한다', async () => {
  fetchMock.mockResolvedValue(json(memo))
  await expect(
    createHttpApi(contract()).createMemo({ text: memo.text, record_date: memo.record_date }),
  ).resolves.toEqual(memo)
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('작업 방식이 설정되지 않은 202 응답을 메모 저장 완료로 취급하지 않는다', async () => {
  fetchMock.mockResolvedValue(json({ id: 'ai-1', state: 'queued' }, 202))
  await expect(
    createHttpApi(createRestContract()).createMemo({
      text: memo.text,
      record_date: memo.record_date,
    }),
  ).rejects.toMatchObject({ status: 202, code: 'unsupported_async' })
})

it('AI 작업 실패 원인을 보존하고 쓰기 요청을 자동 재시도하지 않는다', async () => {
  vi.useFakeTimers()
  fetchMock
    .mockResolvedValueOnce(json({ state: 'queued', id: 'ai-1' }, 202))
    .mockResolvedValueOnce(json({ state: 'error', message: '분석 서버가 응답하지 않았어요.' }))
  const pending = createHttpApi(contract()).createMemo({
    text: memo.text,
    record_date: memo.record_date,
  })
  const rejected = expect(pending).rejects.toMatchObject({
    code: 'ai_unavailable',
    message: '분석 서버가 응답하지 않았어요.',
  })
  await vi.advanceTimersByTimeAsync(100)
  await rejected
  expect(fetchMock.mock.calls.filter(([, request]) => request.method === 'POST')).toHaveLength(1)
})

it('작업 조회 HTTP 오류를 원래 상태로 보존하고 자동 재시도하지 않는다', async () => {
  vi.useFakeTimers()
  fetchMock
    .mockResolvedValueOnce(json({ state: 'queued', id: 'ai-1' }, 202))
    .mockResolvedValueOnce(new Response('<html>gateway timeout</html>', { status: 504 }))
  const pending = createHttpApi(contract()).createMemo({
    text: memo.text,
    record_date: memo.record_date,
  })
  const rejected = expect(pending).rejects.toMatchObject({ status: 504 })
  await vi.advanceTimersByTimeAsync(100)
  await rejected
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it.each([{ state: 'queued' }, { state: 'unknown', id: 'ai-1' }, null])(
  '잘못된 작업 응답 %j를 즉시 중단한다',
  async (body) => {
    fetchMock.mockResolvedValue(json(body, 202))
    await expect(
      createHttpApi(contract()).createMemo({ text: memo.text, record_date: memo.record_date }),
    ).rejects.toMatchObject({ code: 'invalid_response' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  },
)

it('작업 완료 응답도 메모 데이터 검증을 통과해야 한다', async () => {
  fetchMock.mockResolvedValue(json({ state: 'done', result: { memo_id: 41 } }))
  await expect(
    createHttpApi(contract()).createMemo({ text: memo.text, record_date: memo.record_date }),
  ).rejects.toMatchObject({ code: 'invalid_response' })
})

it('모든 조회와 대기 시간에 하나의 제한 시간을 적용한다', async () => {
  vi.useFakeTimers()
  fetchMock.mockImplementation(async () => json({ state: 'running', id: 'ai-1' }))
  const pending = createHttpApi(contract(250)).createMemo({
    text: memo.text,
    record_date: memo.record_date,
  })
  const rejected = expect(pending).rejects.toMatchObject({ code: 'timeout' })
  await vi.advanceTimersByTimeAsync(250)
  await rejected
  expect(fetchMock).toHaveBeenCalledTimes(3)
  await vi.advanceTimersByTimeAsync(1000)
  expect(fetchMock).toHaveBeenCalledTimes(3)
})

it('인증 정보를 기다리는 시간도 작업 제한 시간에 포함한다', async () => {
  vi.useFakeTimers()
  let finish!: (headers: HeadersInit) => void
  const pending = createHttpApi(contract(200), {
    headers: () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  }).createMemo({ text: memo.text, record_date: memo.record_date })
  const rejected = expect(pending).rejects.toMatchObject({ code: 'timeout' })
  await vi.advanceTimersByTimeAsync(200)
  await rejected
  finish({ Authorization: 'Bearer late' })
  await Promise.resolve()
  expect(fetchMock).not.toHaveBeenCalled()
})

it('응답 헤더만 도착하고 본문이 멈춰도 작업 제한 시간에 중단한다', async () => {
  vi.useFakeTimers()
  let finish!: () => void
  const body = new ReadableStream({
    start: (controller) => {
      finish = () => controller.close()
    },
  })
  fetchMock.mockResolvedValue(new Response(body))
  const pending = createHttpApi(contract(200)).createMemo({
    text: memo.text,
    record_date: memo.record_date,
  })
  const rejected = expect(pending).rejects.toMatchObject({ code: 'timeout' })
  await vi.advanceTimersByTimeAsync(200)
  await rejected
  finish()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('폴링 응답이 도착하기 전 공간이 바뀌면 이전 작업 결과를 버린다', async () => {
  vi.useFakeTimers()
  const value = contract()
  value.capabilities.workspace = true
  adoptWorkspace('first')
  let finish!: (response: Response) => void
  fetchMock
    .mockResolvedValueOnce(json({ state: 'queued', id: 'ai-1' }, 202))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
  const pending = createHttpApi(value).createMemo({
    text: memo.text,
    record_date: memo.record_date,
  })
  const rejected = expect(pending).rejects.toMatchObject({ code: 'workspace_changed' })
  await vi.advanceTimersByTimeAsync(100)
  adoptWorkspace('second')
  finish(json({ state: 'done', result: memo }))
  await rejected
  expect(new Headers(fetchMock.mock.calls[1][1].headers).get('X-Itda-Workspace')).toBe('first')
})

it('폴링이 외부 주소로 인증 정보를 전송하지 못한다', async () => {
  vi.useFakeTimers()
  const value = contract()
  value.endpoints.createMemo.job = {
    read: () => ({
      state: 'pending',
      request: { path: '//other.example.test/tasks/1' },
      retryAfterMs: 100,
    }),
  }
  fetchMock.mockResolvedValue(json({ id: 'ai-1' }, 202))
  const pending = createHttpApi(value).createMemo({
    text: memo.text,
    record_date: memo.record_date,
  })
  const rejected = expect(pending).rejects.toMatchObject({ code: 'invalid_request' })
  await vi.advanceTimersByTimeAsync(100)
  await rejected
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('작업 조회에 쓰기 메서드가 설정되면 원래 요청을 재전송하지 않고 중단한다', async () => {
  const value = contract()
  value.endpoints.createMemo.job = {
    read: () => ({ state: 'pending', request: { path: '/observations', method: 'POST' } }),
  }
  fetchMock.mockResolvedValue(json({ id: 'ai-1' }, 202))
  await expect(
    createHttpApi(value).createMemo({ text: memo.text, record_date: memo.record_date }),
  ).rejects.toMatchObject({ code: 'invalid_response' })
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('선택 기능이 없는 계약에서는 해당 API를 호출하지 않는다', async () => {
  const value = contract()
  value.capabilities.patient = false
  const api = createHttpApi(value)
  await expect(api.patient()).rejects.toMatchObject({ code: 'unsupported_operation' })
  await expect(api.savePatient({ alias: '보호자' })).rejects.toMatchObject({
    code: 'unsupported_operation',
  })
  await expect(api.loadDemo()).rejects.toMatchObject({ code: 'unsupported_operation' })
  expect(fetchMock).not.toHaveBeenCalled()
})

it('기록 공간을 구분하지 않는 계약에서 샘플 전환을 켤 수 없다', () => {
  const value = contract()
  value.capabilities.demo = true
  expect(() => createHttpApi(value)).toThrow('샘플 전환에는 기록 공간 확인 설정이 필요해요.')
})

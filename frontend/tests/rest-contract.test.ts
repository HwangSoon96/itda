// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { createHttpApi } from '../src/api/httpApi'
import { createRestContract } from '../src/api/restContract'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it.each(['deleteMemo', 'deleteVisit', 'deleteMedication', 'deleteQuestion'] as const)(
  'data 응답 규약의 %s는 204와 {data:null} 성공 응답을 처리한다',
  async (operation) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ data: null }))
      .mockResolvedValueOnce(Response.json({ data: { unexpected: true } }))
    vi.stubGlobal('fetch', fetchMock)
    const api = createHttpApi(createRestContract({ envelope: 'data' }))
    await expect(api[operation](1)).resolves.toBeUndefined()
    await expect(api[operation](2)).resolves.toBeUndefined()
    await expect(api[operation](3)).rejects.toMatchObject({ code: 'invalid_response' })
  },
)

it('메모 삭제를 한 번 요청하고 서버 삭제 실패는 호출자에게 전달한다', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(
      Response.json(
        { message: '삭제할 수 없는 메모', code: 'memo_delete_conflict' },
        { status: 409 },
      ),
    )
  vi.stubGlobal('fetch', fetchMock)
  const api = createHttpApi(createRestContract())
  await expect(api.deleteMemo(41)).resolves.toBeUndefined()
  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    '/memos/41',
    expect.objectContaining({ method: 'DELETE', body: undefined }),
  )
  await expect(api.deleteMemo(42)).rejects.toMatchObject({
    status: 409,
    code: 'memo_delete_conflict',
    message: '삭제할 수 없는 메모',
  })
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it('팀 서버의 삭제 경로와 응답을 어댑터에서 변경할 수 있다', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ removed: true }))
  vi.stubGlobal('fetch', fetchMock)
  const contract = createRestContract()
  contract.endpoints.deleteMemo = {
    request: (id) => ({ path: `/v2/observations/${id}`, method: 'DELETE' }),
    decode: (value) => {
      if (!value || typeof value !== 'object' || !('removed' in value) || value.removed !== true)
        throw new Error('Invalid deletion result')
    },
  }
  await expect(createHttpApi(contract).deleteMemo(41)).resolves.toBeUndefined()
  expect(fetchMock).toHaveBeenCalledWith(
    '/v2/observations/41',
    expect.objectContaining({ method: 'DELETE' }),
  )
})

const updatedMemo = {
  memo_id: 41,
  record_date: '2026-09-23',
  text: '수정한 관찰 메모',
  status: 'pending',
  events: [],
  emergency: { matched: false, message: null },
}
it.each(['bare', 'data'] as const)(
  '원문 수정은 PATCH 한 번으로 요청하고 %s 응답을 검사한다',
  async (envelope) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json(envelope === 'data' ? { data: updatedMemo } : updatedMemo))
    vi.stubGlobal('fetch', fetchMock)
    const contract = createRestContract({ envelope })
    const body = { text: updatedMemo.text, request_id: 'edit-once' }
    expect(contract.endpoints.updateMemo.request(41, body).timeoutMs).toBe(260000)
    await expect(createHttpApi(contract).updateMemo(41, body)).resolves.toMatchObject({
      ...updatedMemo,
      status: '확인 대기',
    })
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      '/memos/41',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    )
  },
)

it('수정의 저장된 정리 실패는 반환하고 원시 AI 응답이나 서버 오류는 성공으로 처리하지 않는다', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ ...updatedMemo, status: 'failed', error: '정리 실패' }))
    .mockResolvedValueOnce(Response.json({ events: [] }))
    .mockResolvedValueOnce(
      Response.json({ message: '원문 충돌', code: 'memo_conflict' }, { status: 409 }),
    )
  vi.stubGlobal('fetch', fetchMock)
  const api = createHttpApi(createRestContract())
  await expect(api.updateMemo(41, { text: updatedMemo.text })).resolves.toMatchObject({
    memo_id: 41,
    text: updatedMemo.text,
    status: '정리 실패',
  })
  await expect(api.updateMemo(41, { text: updatedMemo.text })).rejects.toMatchObject({
    code: 'invalid_response',
  })
  await expect(api.updateMemo(41, { text: updatedMemo.text })).rejects.toMatchObject({
    status: 409,
    code: 'memo_conflict',
  })
})

it('팀 수정 경로와 비동기 작업을 연결해도 PATCH를 반복하지 않고 완료만 반환한다', async () => {
  vi.useFakeTimers()
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ task: 'edit-41' }, { status: 202 }))
    .mockResolvedValueOnce(Response.json(updatedMemo))
  vi.stubGlobal('fetch', fetchMock)
  const contract = createRestContract()
  contract.endpoints.updateMemo.request = (id, body) => ({
    path: `/observations/${id}/source`,
    method: 'PATCH',
    body: { content: body.text, key: body.request_id },
    timeoutMs: 260000,
  })
  contract.endpoints.updateMemo.job = {
    read: (response) => {
      if (response.status !== 202) return { state: 'complete', value: response.body }
      if (
        !response.body ||
        typeof response.body !== 'object' ||
        !('task' in response.body) ||
        typeof response.body.task !== 'string'
      )
        throw new Error('Invalid edit task')
      return {
        state: 'pending',
        request: { path: `/tasks/${encodeURIComponent(response.body.task)}` },
        retryAfterMs: 100,
      }
    },
  }
  const response = createHttpApi(contract).updateMemo(41, {
    text: updatedMemo.text,
    request_id: 'edit-job',
  })
  await vi.advanceTimersByTimeAsync(100)
  await expect(response).resolves.toMatchObject({
    memo_id: 41,
    text: updatedMemo.text,
    status: '확인 대기',
  })
  expect(fetchMock.mock.calls.map(([path, request]) => [path, request.method])).toEqual([
    ['/observations/41/source', 'PATCH'],
    ['/tasks/edit-41', 'GET'],
  ])
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    content: updatedMemo.text,
    key: 'edit-job',
  })
})

// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { adoptWorkspace, ApiError, blockWorkspace, requestWorkspace, send } from '../src/api/client'

const fetchMock = vi.fn()
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })

beforeEach(() => {
  blockWorkspace()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_BASE_URL', '')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it('API 주소에 경로를 붙이고 현재 인증 헤더와 쿠키 설정을 매 요청에 적용한다', async () => {
  let token = 'session-one'
  const headers = vi.fn(async () => ({ Authorization: `Bearer ${token}` }))
  fetchMock.mockImplementation(async () => json({ ok: true }))
  const options = {
    baseUrl: 'https://api.example.test/v2/',
    credentials: 'include' as const,
    headers,
  }
  await send({ path: '/care/memos', method: 'POST', body: { text: '산책함' } }, options)
  token = 'session-two'
  await send({ path: '/care/memos' }, options)

  expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/v2/care/memos')
  expect(fetchMock.mock.calls[0][1]).toMatchObject({
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ text: '산책함' }),
  })
  const first = new Headers(fetchMock.mock.calls[0][1].headers)
  const second = new Headers(fetchMock.mock.calls[1][1].headers)
  expect(first.get('Authorization')).toBe('Bearer session-one')
  expect(first.get('Content-Type')).toBe('application/json')
  expect(second.get('Authorization')).toBe('Bearer session-two')
  expect(second.get('Content-Type')).toBeNull()
  expect(first.get('X-Itda-Request')).toBeNull()
  expect(first.get('X-Itda-Workspace')).toBeNull()
})

it('DELETE의 204 응답은 JSON 읽기 없이 완료된다', async () => {
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
  await expect(send({ path: '/questions/1', method: 'DELETE' })).resolves.toEqual({
    status: 204,
    body: undefined,
  })
})

it.each([400, 401, 422, 500])(
  'JSON 오류 응답의 HTTP %s, 메시지와 오류 코드를 보존한다',
  async (status) => {
    fetchMock.mockResolvedValue(
      json({ error: { message: '다시 로그인해 주세요.', code: 'session_expired' } }, status),
    )
    await expect(send({ path: '/questions' })).rejects.toMatchObject({
      status,
      code: 'session_expired',
      message: '다시 로그인해 주세요.',
    })
  },
)

it('입력 검증 오류의 배열을 사용자 메시지로 변환한다', async () => {
  fetchMock.mockResolvedValue(
    json({ detail: [{ msg: '날짜가 필요해요.' }, { msg: '메모가 필요해요.' }] }, 422),
  )
  await expect(send({ path: '/memos' })).rejects.toMatchObject({
    status: 422,
    message: '날짜가 필요해요. · 메모가 필요해요.',
  })
})

it('서버별 오류 봉투를 변환해도 HTTP 상태를 그대로 유지한다', async () => {
  fetchMock.mockResolvedValue(
    json({ problem: { label: '로그인 시간이 지났어요.', reason: 'expired' } }, 401),
  )
  const decodeError = vi.fn((response: { status: number; body: unknown }) => {
    const value = response.body as { problem: { label: string; reason: string } }
    return { message: value.problem.label, code: value.problem.reason }
  })
  await expect(send({ path: '/memos' }, { decodeError })).rejects.toMatchObject({
    status: 401,
    code: 'expired',
    message: '로그인 시간이 지났어요.',
  })
  expect(decodeError).toHaveBeenCalledWith({
    status: 401,
    body: { problem: { label: '로그인 시간이 지났어요.', reason: 'expired' } },
  })
})

it('오류 봉투가 예상과 달라도 원래 HTTP 오류를 연결 실패로 바꾸지 않는다', async () => {
  fetchMock.mockResolvedValue(new Response('upstream error', { status: 503 }))
  await expect(
    send(
      { path: '/memos' },
      {
        decodeError: () => {
          throw new Error('unknown envelope')
        },
      },
    ),
  ).rejects.toMatchObject({
    status: 503,
    message: '요청을 처리하지 못했어요.',
  })
})

it('HTML 502 응답을 연결 오류로 덮어쓰거나 원문 그대로 노출하지 않는다', async () => {
  fetchMock.mockResolvedValue(new Response('<html>gateway internals</html>', { status: 502 }))
  await expect(send({ path: '/memos' })).rejects.toMatchObject({
    status: 502,
    message: '요청을 처리하지 못했어요.',
  })
})

it('정상 상태 코드의 잘못된 JSON은 응답 형식 오류로 구분한다', async () => {
  fetchMock.mockResolvedValue(new Response('<html>frontend index</html>', { status: 200 }))
  await expect(send({ path: '/health' })).rejects.toMatchObject({
    status: 200,
    code: 'invalid_response',
  })
})

it('네트워크 실패를 HTTP 응답 오류와 구분한다', async () => {
  fetchMock.mockRejectedValue(new TypeError('fetch failed'))
  await expect(send({ path: '/health' })).rejects.toMatchObject({
    status: 0,
    code: 'connection_error',
  })
})

it.each([
  'https://other.example.test/memos',
  '//other.example.test/memos',
  '/\\other.example.test/memos',
  '/../health',
  '/v1/../health',
  '/%2e%2e/health',
  '/%252e%252e/health',
  '/%2f%2fevil/health',
  '/memo#fragment',
  '/memo\n',
  '/%zz',
])('서버 경로 %s로 API 접두어나 호스트를 벗어나는 요청을 보내지 않는다', async (path) => {
  await expect(send({ path }, { baseUrl: '/api' })).rejects.toMatchObject({
    code: 'invalid_request',
  })
  expect(fetchMock).not.toHaveBeenCalled()
})

it('다른 URL이 검색 값에 들어가도 지정한 API 호스트로만 요청한다', async () => {
  fetchMock.mockResolvedValue(json([]))
  await send({ path: '/memos?text=https%3A%2F%2Fexample.test' }, { baseUrl: '/api' })
  expect(fetchMock.mock.calls[0][0]).toBe('/api/memos?text=https%3A%2F%2Fexample.test')
})

it('취소된 요청은 인증 헤더나 네트워크를 호출하지 않는다', async () => {
  const controller = new AbortController()
  controller.abort()
  const headers = vi.fn(() => ({}))
  await expect(
    send({ path: '/memos' }, { signal: controller.signal, headers }),
  ).rejects.toMatchObject({ code: 'aborted' })
  expect(headers).not.toHaveBeenCalled()
  expect(fetchMock).not.toHaveBeenCalled()
})

it('인증 정보를 기다리는 중 취소되면 늦게 도착한 인증 정보로 요청하지 않는다', async () => {
  const controller = new AbortController()
  let finish!: (value: HeadersInit) => void
  const pending = send(
    { path: '/memos' },
    {
      signal: controller.signal,
      headers: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    },
  )
  const rejected = expect(pending).rejects.toMatchObject({ code: 'aborted' })
  controller.abort()
  await rejected
  finish({ Authorization: 'Bearer late-session' })
  await Promise.resolve()
  expect(fetchMock).not.toHaveBeenCalled()
})

it('서버 공간 불일치는 활성 요청의 공간을 차단한다', async () => {
  adoptWorkspace('current')
  fetchMock.mockResolvedValue(json({ code: 'workspace_changed', message: '공간 변경' }, 409))
  await expect(send({ path: '/memos' }, { workspaceId: 'current' })).rejects.toMatchObject({
    code: 'workspace_changed',
  })
  expect(() => requestWorkspace()).toThrow(ApiError)
})

it('이전 공간의 늦은 오류는 새로 채택한 공간을 차단하지 않는다', async () => {
  adoptWorkspace('old')
  let finish!: (response: Response) => void
  fetchMock.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  const pending = send({ path: '/memos' }, { workspaceId: 'old' })
  const rejected = expect(pending).rejects.toMatchObject({ code: 'workspace_changed' })
  adoptWorkspace('new')
  finish(json({ code: 'workspace_changed' }, 409))
  await rejected
  expect(requestWorkspace()).toBe('new')
})

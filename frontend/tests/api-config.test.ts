// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()
const response = (value: unknown, status = 200) => Response.json(value, { status })

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('VITE_USE_MOCK', 'false')
  vi.stubEnv('VITE_API_BASE_URL', '')
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it.each([
  [undefined, '/health'],
  ['', '/health'],
  ['/api/', '/api/health'],
  ['https://api.example.test/itda///', 'https://api.example.test/itda/health'],
])('API 기본 주소 %s로 상태 요청을 보내며 끝의 슬래시를 정리한다', async (baseUrl, expectedUrl) => {
  vi.stubEnv('VITE_API_BASE_URL', baseUrl)
  const { api } = await import('../src/api')
  const health = { ok: true }
  fetchMock.mockResolvedValue(response(health))

  await expect(api.health()).resolves.toMatchObject(health)

  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
    expectedUrl,
    expect.objectContaining({
      method: 'GET',
      credentials: 'same-origin',
    }),
  )
  expect(new Headers(fetchMock.mock.calls[0][1].headers).has('X-Itda-Workspace')).toBe(false)
})

it('설정한 API 주소로 조회 조건과 저장 본문을 보내며 공간 헤더를 강제하지 않는다', async () => {
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test/v1/')
  const { api, adoptWorkspace } = await import('../src/api')
  adoptWorkspace('workspace-a')
  fetchMock
    .mockResolvedValueOnce(response([]))
    .mockResolvedValueOnce(
      response({ id: 7, text: '진료 질문', created_at: '2026-09-28T10:00:00' }),
    )

  await api.memos({ from: '2026-09-01', to: '2026-09-28' })
  await api.addQuestion({ text: '진료 질문', period_start: '2026-09-01', period_end: '2026-09-28' })

  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    'https://api.example.test/v1/memos?from=2026-09-01&to=2026-09-28',
    expect.objectContaining({ method: 'GET' }),
  )
  expect(new Headers(fetchMock.mock.calls[0][1].headers).has('X-Itda-Workspace')).toBe(false)
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    'https://api.example.test/v1/questions',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        text: '진료 질문',
        period_start: '2026-09-01',
        period_end: '2026-09-28',
      }),
    }),
  )
})

it.each([undefined, '', 'false', 'TRUE', '1'])(
  'mock 설정 %s에서는 연결 실패를 샘플 데이터로 대체하지 않는다',
  async (mockSetting) => {
    vi.stubEnv('VITE_USE_MOCK', mockSetting)
    const { api, ApiError, USE_MOCK } = await import('../src/api')
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await expect(api.health()).rejects.toBeInstanceOf(ApiError)
    expect(USE_MOCK).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  },
)

it('명시적으로 mock을 켠 경우에만 네트워크 없이 샘플 기록 공간을 사용한다', async () => {
  vi.stubEnv('VITE_USE_MOCK', 'true')
  const { api, adoptWorkspace, USE_MOCK } = await import('../src/api')

  const health = await api.health()
  adoptWorkspace(health.workspace_id)
  const saved = await api.addQuestion({ text: '샘플 공간의 질문' })

  expect(USE_MOCK).toBe(true)
  expect(health.workspace_id).toEqual(expect.any(String))
  expect(saved.text).toBe('샘플 공간의 질문')
  expect(await api.questions()).toContainEqual(saved)
  expect(fetchMock).not.toHaveBeenCalled()
})

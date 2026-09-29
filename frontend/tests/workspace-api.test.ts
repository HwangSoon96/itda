import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { adoptWorkspace, blockWorkspace } from '../src/api'
import { createHttpApi } from '../src/api/httpApi'
import { createRestContract } from '../src/api/restContract'
const realApi = createHttpApi(createRestContract({ capabilities: { workspace: true } }))
const fetchMock = vi.fn()
const response = (value: unknown, status = 200) => Response.json(value, { status })
beforeEach(() => {
  blockWorkspace()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

it('health 조회가 공간 토큰을 자동 채택하지 않고 채택 전 데이터 요청을 보내지 않는다', async () => {
  fetchMock.mockResolvedValue(response({ ok: true, workspace_id: 'new' }))
  await realApi.health()
  await expect(realApi.addQuestion({ text: '질문' })).rejects.toMatchObject({
    code: 'workspace_changed',
  })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(new Headers(fetchMock.mock.calls[0][1].headers).get('X-Itda-Workspace')).toBeNull()
})

it('다른 서버의 health를 읽어도 이전 토큰으로 요청하고 불일치 후 재저장을 차단한다', async () => {
  adoptWorkspace('old')
  const event = vi.fn()
  window.addEventListener('itda-workspace-changed', event)
  const writes: unknown[] = []
  fetchMock.mockImplementation(async (path: string, options: RequestInit) => {
    if (path === '/health') return response({ ok: true, workspace_id: 'new' })
    if (new Headers(options.headers).get('X-Itda-Workspace') !== 'new')
      return response({ code: 'workspace_changed', detail: '공간 변경' }, 409)
    writes.push(options.body)
    return response({ id: 1, text: '질문', created_at: '2026-09-28T10:00:00' })
  })
  try {
    await realApi.health()
    await expect(realApi.addQuestion({ text: '질문' })).rejects.toMatchObject({
      code: 'workspace_changed',
    })
    await expect(realApi.addQuestion({ text: '질문' })).rejects.toMatchObject({
      code: 'workspace_changed',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(event).toHaveBeenCalledTimes(1)
    expect(writes).toEqual([])
    adoptWorkspace('new')
    await realApi.addQuestion({ text: '질문' })
    expect(writes).toHaveLength(1)
  } finally {
    window.removeEventListener('itda-workspace-changed', event)
  }
})

it.each([200, 409])(
  '채택 전 시작한 늦은 응답(%s)은 버리며 새 공간을 다시 차단하지 않는다',
  async (status) => {
    adoptWorkspace('old')
    let finish!: (value: ReturnType<typeof response>) => void
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const oldResponse = realApi.memos()
    const rejected = expect(oldResponse).rejects.toMatchObject({ code: 'workspace_changed' })
    adoptWorkspace('new')
    const event = vi.fn()
    window.addEventListener('itda-workspace-changed', event)
    try {
      finish(response(status === 409 ? { code: 'workspace_changed' } : [{ memo_id: 99 }], status))
      await rejected
      expect(event).not.toHaveBeenCalled()
      fetchMock.mockResolvedValueOnce(
        response({ id: 3, visit_date: '2026-09-27', status: 'scheduled' }),
      )
      await realApi.addVisit({ visit_date: '2026-09-27' })
      expect(new Headers(fetchMock.mock.calls.at(-1)[1].headers).get('X-Itda-Workspace')).toBe(
        'new',
      )
    } finally {
      window.removeEventListener('itda-workspace-changed', event)
    }
  },
)

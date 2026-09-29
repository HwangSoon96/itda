// @vitest-environment node
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, it } from 'vitest'
import { ApiError } from '../src/api/client'
import { decoders } from '../src/api/decoders'
import { createHttpApi } from '../src/api/httpApi'
import { createRestContract } from '../src/api/restContract'

it('다른 서버 경로·본문·응답과 비동기 AI 작업을 화면 메서드 변경 없이 연결한다', async () => {
  const calls: {
    path: string
    method: string
    body: unknown
    auth: string | undefined
    workspace: string | string[] | undefined
  }[] = []
  const memo = {
    memo_id: 41,
    text: '밤에 두 번 깸',
    record_date: '2026-09-23',
    created_at: '2026-09-28T08:00:00Z',
    status: 'pending',
    emergency: { matched: false, message: null },
    events: [
      {
        type: 'night_waking',
        status: 'present',
        time_expr: '밤',
        count: 2,
        evidence: '밤에 두 번 깸',
      },
    ],
  }
  let pollCount = 0
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const part of req) body += part
    calls.push({
      path: req.url!,
      method: req.method!,
      body: body ? JSON.parse(body) : undefined,
      auth: req.headers.authorization,
      workspace: req.headers['x-itda-workspace'],
    })
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/v2/status') res.end(JSON.stringify({ state: 'ready' }))
    else if (req.url === '/v2/observations') {
      res.statusCode = 202
      res.end(JSON.stringify({ job: 'job-41', state: 'queued' }))
    } else if (req.url === '/v2/jobs/job-41') {
      pollCount++
      res.end(
        JSON.stringify(
          pollCount === 1
            ? { job: 'job-41', state: 'running' }
            : { state: 'done', output: { data: memo } },
        ),
      )
    } else if (req.url === '/v2/observations/41/approval') {
      res.end(JSON.stringify({ data: { ...memo, status: 'confirmed' } }))
    } else {
      res.statusCode = 404
      res.end('{}')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const contract = createRestContract({ envelope: 'data', capabilities: { patient: false } })
    contract.endpoints.health = {
      request: () => ({ path: '/v2/status' }),
      decode: (value) => {
        if (!value || typeof value !== 'object' || !('state' in value))
          throw new ApiError('Invalid health', 502, 'invalid_response')
        return decoders.health({ ok: value.state === 'ready' })
      },
    }
    contract.endpoints.createMemo.request = (body) => ({
      path: '/v2/observations',
      method: 'POST',
      timeoutMs: 2000,
      body: { content: body.text, observedOn: body.record_date, requestKey: body.request_id },
    })
    contract.endpoints.createMemo.job = {
      read: ({ body }) => {
        if (!body || typeof body !== 'object' || !('state' in body))
          throw new ApiError('Invalid job', 502, 'invalid_response')
        if (body.state === 'done' && 'output' in body)
          return { state: 'complete', value: body.output }
        if (
          (body.state === 'queued' || body.state === 'running') &&
          'job' in body &&
          typeof body.job === 'string'
        )
          return {
            state: 'pending',
            request: { path: `/v2/jobs/${encodeURIComponent(body.job)}` },
            retryAfterMs: 1,
          }
        return { state: 'failed', message: '작업 실패', code: 'processing_failed' }
      },
    }
    const confirmRequest = contract.endpoints.confirmMemo.request
    contract.endpoints.confirmMemo.request = (id, body) => ({
      ...confirmRequest(id, body),
      path: `/v2/observations/${id}/approval`,
      method: 'PUT',
    })
    const api = createHttpApi(contract, {
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      headers: () => ({ Authorization: 'Bearer test-session' }),
    })
    expect(await api.health()).toMatchObject({ ok: true, workspace_id: '', ai_available: null })
    const result = await api.createMemo({
      text: memo.text,
      record_date: memo.record_date,
      request_id: 'request-41',
    })
    expect(result.status).toBe('확인 대기')
    expect(result.record_date).toBe('2026-09-23')
    expect(result).not.toHaveProperty('created_at')
    expect(result.events[0]).toMatchObject({ type: '야간 각성', status: '있었음', count: 2 })
    const confirmed = await api.confirmMemo(result.memo_id, { events: result.events })
    expect(confirmed.status).toBe('확인 완료')
    expect(calls.map(({ path, method }) => [method, path])).toEqual([
      ['GET', '/v2/status'],
      ['POST', '/v2/observations'],
      ['GET', '/v2/jobs/job-41'],
      ['GET', '/v2/jobs/job-41'],
      ['PUT', '/v2/observations/41/approval'],
    ])
    expect(calls[1].body).toEqual({
      content: memo.text,
      observedOn: memo.record_date,
      requestKey: 'request-41',
    })
    expect(calls[4].body).toMatchObject({
      events: [{ type: 'night_waking', status: 'present', count: 2 }],
    })
    expect(calls.every((call) => call.auth === 'Bearer test-session' && !call.workspace)).toBe(true)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})

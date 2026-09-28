// @vitest-environment node
import { createServer as createHttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as createViteServer } from 'vite'
import { expect, it } from 'vitest'
import { createApiProxy } from '../config/devProxy'

it('명시한 API 접두어를 제거해 새 서버 경로에도 전달한다', async () => {
  const seen: string[] = []
  const backend = createHttpServer((req, res) => {
    seen.push(req.url ?? '')
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  })
  await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve))
  const backendPort = (backend.address() as AddressInfo).port
  const cacheDir = await mkdtemp(join(tmpdir(), 'itda-proxy-test-'))
  const vite = await createViteServer({
    cacheDir,
    optimizeDeps: { noDiscovery: true, include: [] },
    configFile: false,
    appType: 'custom',
    server: {
      host: '127.0.0.1',
      port: 0,
      proxy: createApiProxy({
        VITE_API_BASE_URL: '/api/',
        ITDA_API_TARGET: `http://127.0.0.1:${backendPort}`,
      }),
    },
  })
  try {
    await vite.listen()
    const port = (vite.httpServer!.address() as AddressInfo).port
    const response = await fetch(`http://127.0.0.1:${port}/api/v2/observations?limit=10`)
    expect(await response.json()).toEqual({ ok: true })
    expect(seen).toEqual(['/v2/observations?limit=10'])
    const outside = await fetch(`http://127.0.0.1:${port}/api-other`)
    expect(outside.status).toBe(404)
    expect(seen).toHaveLength(1)
  } finally {
    await vite.close()
    await rm(cacheDir, { recursive: true, force: true })
    await new Promise<void>((resolve, reject) =>
      backend.close((error) => (error ? reject(error) : resolve())),
    )
  }
})

it('절대 API 주소와 샘플 모드에서는 개발 프록시를 만들지 않는다', () => {
  expect(createApiProxy({ VITE_API_BASE_URL: 'https://api.example.test/v1' })).toBeUndefined()
  expect(createApiProxy({ VITE_USE_MOCK: 'true' })).toBeUndefined()
})

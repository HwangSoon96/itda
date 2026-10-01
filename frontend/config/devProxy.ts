import type { ProxyOptions } from 'vite'

const rootRoutes = [
  'health',
  'patient',
  'memos',
  'events',
  'visits',
  'medications',
  'questions',
  'summary',
  'trends',
  'demo',
  'docs',
  'openapi.json',
]
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function createApiProxy(
  env: Record<string, string>,
): Record<string, ProxyOptions> | undefined {
  if (env.VITE_USE_MOCK === 'true') return undefined
  const base = (env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')
  if (/^https?:\/\//.test(base)) return undefined
  if (base && (!base.startsWith('/') || base.startsWith('//') || /[?#\\]/.test(base)))
    throw new Error('VITE_API_BASE_URL must be an absolute HTTP URL or a path such as /api')
  const options: ProxyOptions = {
    target: env.ITDA_API_TARGET || 'http://127.0.0.1:8000',
    timeout: 390000,
    proxyTimeout: 390000,
  }
  if (base) {
    return {
      [`^${escapePattern(base)}(?:/|\\?|$)`]: {
        ...options,
        rewrite: (path) => path.slice(base.length) || '/',
      },
    }
  }
  return Object.fromEntries(
    rootRoutes.map((route) => [`^/${escapePattern(route)}(?:/|\\?|$)`, options]),
  )
}

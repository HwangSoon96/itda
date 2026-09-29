import type { HttpClientOptions, HttpRequest, HttpResponse } from './contract'

export class ApiError extends Error {
  status: number
  code?: string

  constructor(message: string, status = 0, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

let workspaceId: string | null = null
let workspaceBlocked = true

export function adoptWorkspace(id: string) {
  if (!id) throw new ApiError('기록 공간 정보를 확인하지 못했어요. 연결을 다시 확인해 주세요.')
  workspaceId = id
  workspaceBlocked = false
}

export function blockWorkspace() {
  workspaceBlocked = true
}

function changedError() {
  return new ApiError(
    '기록 공간이 바뀌었어요. 현재 기록 공간을 확인한 뒤 이어가 주세요.',
    409,
    'workspace_changed',
  )
}

export function rejectWorkspace() {
  blockWorkspace()
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('itda-workspace-changed'))
  return changedError()
}

export function requestWorkspace() {
  if (!workspaceId || workspaceBlocked) throw changedError()
  return workspaceId
}

export function checkResponseWorkspace(id: string) {
  // A response begun before recovery must never populate the newly adopted workspace.
  if (workspaceBlocked || workspaceId !== id) throw changedError()
}

function configurationError() {
  return new ApiError('서버 연결 설정을 확인해 주세요.', 0, 'invalid_request')
}

function containsControlCharacters(value: string) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code <= 32 || code === 127
  })
}

function safePath(path: string) {
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    /[\\#]/.test(path) ||
    containsControlCharacters(path)
  ) {
    throw configurationError()
  }
  const pathname = path.split('?')[0]
  for (const segment of pathname.split('/')) {
    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      throw configurationError()
    }
    // Encoded separators and traversal must not escape a configured API prefix.
    if (
      decoded === '.' ||
      decoded === '..' ||
      /[/\\%]/.test(decoded) ||
      containsControlCharacters(decoded)
    ) {
      throw configurationError()
    }
  }
}

function requestUrl(path: string, configuredBase?: string) {
  safePath(path)
  const base = (configuredBase ?? import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')
  if (!base) return path
  if (base.startsWith('/')) {
    if (base.includes('?')) throw configurationError()
    safePath(base)
    return base + path
  }
  let parsed: URL
  try {
    parsed = new URL(base)
  } catch {
    throw configurationError()
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw configurationError()
  }
  safePath(parsed.pathname)
  return base + path
}

function aborted(signal?: AbortSignal) {
  return signal?.reason instanceof ApiError
    ? signal.reason
    : new ApiError('요청이 취소되었어요.', 0, 'aborted')
}

/** Makes headers, body reads and fetch share the caller's operation deadline. */
function withSignal<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work
  if (signal.aborted) return Promise.reject(aborted(signal))
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(aborted(signal))
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function errorDetails(value: unknown) {
  const outer = object(value)
  const nested = object(outer?.error)
  const detail = outer?.detail ?? outer?.message ?? nested?.message
  const code = outer?.code ?? nested?.code
  let message = typeof detail === 'string' ? detail : undefined
  if (Array.isArray(detail)) {
    message = detail
      .map((item) => object(item)?.msg)
      .filter((item): item is string => typeof item === 'string')
      .join(' · ')
  }
  return {
    message: message && !/<\/?[a-z][\s\S]*>/i.test(message) ? message : '요청을 처리하지 못했어요.',
    code: typeof code === 'string' ? code : undefined,
  }
}

export async function send(
  request: HttpRequest,
  options: HttpClientOptions & { signal?: AbortSignal; workspaceId?: string } = {},
): Promise<HttpResponse> {
  const { signal, workspaceId: id } = options
  const url = requestUrl(request.path, options.baseUrl)
  if (signal?.aborted) throw aborted(signal)
  if (id) checkResponseWorkspace(id)
  try {
    const configuredHeaders = options.headers
      ? await withSignal(Promise.resolve(options.headers()), signal)
      : undefined
    const headers = new Headers(configuredHeaders)
    if (!headers.has('Accept')) headers.set('Accept', 'application/json')
    if (request.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    if (id) headers.set('X-Itda-Workspace', id)
    if (signal?.aborted) throw aborted(signal)
    if (id) checkResponseWorkspace(id)
    const response = await withSignal(
      fetch(url, {
        method: request.method ?? 'GET',
        credentials: options.credentials ?? 'same-origin',
        headers,
        signal,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
      }),
      signal,
    )
    if (id) checkResponseWorkspace(id)
    let value: unknown
    let invalidJson = false
    if (response.status !== 204) {
      const text = await withSignal(response.text(), signal)
      try {
        value = JSON.parse(text)
      } catch {
        invalidJson = true
      }
    }
    if (id) checkResponseWorkspace(id)
    if (!response.ok) {
      let detail = errorDetails(value)
      if (options.decodeError) {
        try {
          const mapped = options.decodeError({ status: response.status, body: value })
          if (mapped) detail = errorDetails(mapped)
        } catch {
          // An invalid error envelope must not replace an HTTP failure with a network error.
        }
      }
      if (id && detail.code === 'workspace_changed') throw rejectWorkspace()
      throw new ApiError(detail.message, response.status, detail.code)
    }
    if (invalidJson) {
      throw new ApiError('서버 응답 형식을 확인하지 못했어요.', response.status, 'invalid_response')
    }
    return { status: response.status, body: value }
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (signal?.aborted) throw aborted(signal)
    throw new ApiError(
      '서버에 연결하지 못했어요. 연결 상태를 확인해 주세요.',
      0,
      'connection_error',
    )
  }
}

import type { Api } from './port'

export interface ApiCapabilities {
  workspace: boolean
  patient: boolean
  demo: boolean
}
export interface HttpRequest {
  path: string
  method?: string
  body?: unknown
  timeoutMs?: number
}
export interface HttpResponse {
  status: number
  body: unknown
}
export interface HttpClientOptions {
  baseUrl?: string
  credentials?: RequestCredentials
  /** Resolve the current session's headers per request. Do not put secrets in VITE_* variables. */
  headers?: () => HeadersInit | Promise<HeadersInit>
  /** Map a server's error envelope; HTTP status is always preserved by the transport. */
  decodeError?: (response: HttpResponse) => { message: string; code?: string } | undefined
}
export type JobStep =
  | { state: 'pending'; request: HttpRequest; retryAfterMs?: number }
  | { state: 'complete'; value: unknown }
  | { state: 'failed'; message: string; code?: string }
export interface JobAdapter {
  read: (response: HttpResponse) => JobStep
}
export interface Endpoint<Args extends unknown[], Result> {
  request: (...args: Args) => HttpRequest
  decode: (data: unknown) => Result
  job?: JobAdapter
}
export interface ApiContract {
  capabilities: ApiCapabilities
  endpoints: {
    [K in keyof Api]: Endpoint<Parameters<Api[K]>, Awaited<ReturnType<Api[K]>>>
  }
}

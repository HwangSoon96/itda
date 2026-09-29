import { ApiError, checkResponseWorkspace, requestWorkspace, send } from './client'
import type {
  ApiContract,
  Endpoint,
  HttpClientOptions,
  HttpRequest,
  HttpResponse,
} from './contract'
import type { Api } from './port'

function delay(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function invalidResponse(status: number) {
  return new ApiError('서버 응답 형식을 확인하지 못했어요.', status, 'invalid_response')
}

function decode<Result>(endpoint: Endpoint<unknown[], Result>, value: unknown, status: number) {
  try {
    return endpoint.decode(value)
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw invalidResponse(status)
  }
}

/** Adapts HTTP and job protocols to the promises consumed by feature screens. */
export function createHttpApi(contract: ApiContract, options: HttpClientOptions = {}): Api {
  if (contract.capabilities.demo && !contract.capabilities.workspace) {
    throw new ApiError('샘플 전환에는 기록 공간 확인 설정이 필요해요.', 0, 'invalid_configuration')
  }
  const operations = Object.fromEntries(
    Object.entries(contract.endpoints).map(([operation, endpoint]) => [
      operation,
      async (...args: unknown[]) => {
        if (
          (!contract.capabilities.patient && ['patient', 'savePatient'].includes(operation)) ||
          (!contract.capabilities.demo && ['loadDemo', 'exitDemo'].includes(operation))
        ) {
          throw new ApiError('현재 서버에서 지원하지 않는 기능이에요.', 0, 'unsupported_operation')
        }
        const adapter = endpoint as Endpoint<unknown[], unknown>
        const id =
          contract.capabilities.workspace && operation !== 'health' ? requestWorkspace() : undefined
        const initial = adapter.request(...args)
        const timeout = initial.timeoutMs ?? 15000
        if (!Number.isFinite(timeout) || timeout <= 0) {
          throw new ApiError('서버 연결 설정을 확인해 주세요.', 0, 'invalid_configuration')
        }
        const controller = new AbortController()
        const timer = setTimeout(
          () =>
            controller.abort(
              new ApiError(
                '응답이 늦어지고 있어요. 최근 기록에서 저장 여부를 확인하거나 다시 시도해 주세요.',
                0,
                'timeout',
              ),
            ),
          timeout,
        )
        const run = (request: HttpRequest) =>
          send(request, { ...options, signal: controller.signal, workspaceId: id })
        try {
          let response: HttpResponse = await run(initial)
          while (true) {
            if (id) checkResponseWorkspace(id)
            if (!adapter.job) {
              if (response.status === 202) {
                throw new ApiError(
                  '서버의 처리 결과 조회 방식이 설정되지 않았어요.',
                  202,
                  'unsupported_async',
                )
              }
              return decode(adapter, response.body, response.status)
            }
            let step
            try {
              step = adapter.job.read(response)
            } catch (error) {
              if (error instanceof ApiError) throw error
              throw invalidResponse(response.status)
            }
            if (step.state === 'complete') return decode(adapter, step.value, response.status)
            if (step.state === 'failed') {
              throw new ApiError(step.message, response.status, step.code ?? 'processing_failed')
            }
            if (
              step.state !== 'pending' ||
              (step.request.method ?? 'GET').toUpperCase() !== 'GET'
            ) {
              // Polling reads a task's status; it must never repeat the original write.
              throw invalidResponse(response.status)
            }
            const interval = step.retryAfterMs ?? 1000
            if (!Number.isFinite(interval) || interval < 0) throw invalidResponse(response.status)
            await delay(Math.max(1, interval), controller.signal)
            response = await run(step.request)
          }
        } finally {
          clearTimeout(timer)
        }
      },
    ]),
  )
  return operations as unknown as Api
}

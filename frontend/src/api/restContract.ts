import { ApiError } from './client'
import type { ApiCapabilities, ApiContract } from './contract'
import {
  decoders,
  wireEvent,
  wireEventType,
  wireMedicationChange,
  wireVisitStatus,
} from './decoders'

export interface RestContractOptions {
  capabilities?: Partial<ApiCapabilities>
  enumStyle?: 'codes' | 'labels'
  envelope?: 'bare' | 'data'
}

function query(values: Record<string, string | undefined>) {
  const entries = Object.entries(values).filter((entry): entry is [string, string] =>
    Boolean(entry[1]),
  )
  return entries.length ? '?' + new URLSearchParams(entries).toString() : ''
}

/** Editable REST mapping. UI types are not a requirement on a server's HTTP schema. */
export function createRestContract(options: RestContractOptions = {}): ApiContract {
  const codes = options.enumStyle !== 'labels'
  const decode =
    <T>(read: (value: unknown) => T) =>
    (value: unknown): T => {
      if (options.envelope !== 'data') return read(value)
      if (!value || typeof value !== 'object' || !('data' in value))
        throw new ApiError('서버 응답 형식을 확인하지 못했어요.', 502, 'invalid_response')
      return read(value.data)
    }
  const decodeEmpty = (value: unknown) =>
    value == null ? decoders.empty(value) : decode(decoders.empty)(value)
  return {
    capabilities: { workspace: false, patient: true, demo: false, ...options.capabilities },
    endpoints: {
      health: { request: () => ({ path: '/health' }), decode: decode(decoders.health) },
      createMemo: {
        request: (body) => ({ path: '/memos', method: 'POST', body, timeoutMs: 260000 }),
        decode: decode(decoders.memo),
      },
      updateMemo: {
        request: (id, body) => ({ path: `/memos/${id}`, method: 'PATCH', body, timeoutMs: 260000 }),
        decode: decode(decoders.memo),
      },
      confirmMemo: {
        request: (id, body) => ({
          path: `/memos/${id}/confirm`,
          method: 'POST',
          body: { ...body, events: codes ? body.events.map(wireEvent) : body.events },
        }),
        decode: decode(decoders.memo),
      },
      memoRevisions: {
        request: (id) => ({ path: `/memos/${id}/revisions` }),
        decode: decode(decoders.revisions),
      },
      retryMemo: {
        request: (id) => ({ path: `/memos/${id}/retry`, method: 'POST', timeoutMs: 260000 }),
        decode: decode(decoders.memo),
      },
      memos: {
        request: (filters = {}) => ({ path: '/memos' + query(filters) }),
        decode: decode(decoders.memos),
      },
      deleteMemo: {
        request: (id) => ({ path: `/memos/${id}`, method: 'DELETE' }),
        decode: decodeEmpty,
      },
      addEvent: {
        request: (body) => ({
          path: '/events',
          method: 'POST',
          body: codes ? { ...wireEvent(body), memo_id: body.memo_id } : body,
        }),
        decode: decode(decoders.memo),
      },
      visits: { request: () => ({ path: '/visits' }), decode: decode(decoders.visits) },
      addVisit: {
        request: (body) => ({
          path: '/visits',
          method: 'POST',
          body: {
            ...body,
            ...(body.status && codes ? { status: wireVisitStatus(body.status) } : {}),
          },
        }),
        decode: decode(decoders.visit),
      },
      updateVisit: {
        request: (id, body) => ({
          path: `/visits/${id}`,
          method: 'PATCH',
          body: { status: codes ? wireVisitStatus(body.status) : body.status },
        }),
        decode: decode(decoders.visit),
      },
      deleteVisit: {
        request: (id) => ({ path: `/visits/${id}`, method: 'DELETE' }),
        decode: decodeEmpty,
      },
      medications: {
        request: () => ({ path: '/medications' }),
        decode: decode(decoders.medications),
      },
      addMedication: {
        request: (body) => ({
          path: '/medications',
          method: 'POST',
          body: {
            ...body,
            change_type: codes ? wireMedicationChange(body.change_type) : body.change_type,
          },
        }),
        decode: decode(decoders.medication),
      },
      deleteMedication: {
        request: (id) => ({ path: `/medications/${id}`, method: 'DELETE' }),
        decode: decodeEmpty,
      },
      questions: { request: () => ({ path: '/questions' }), decode: decode(decoders.questions) },
      addQuestion: {
        request: (body) => ({ path: '/questions', method: 'POST', body }),
        decode: decode(decoders.question),
      },
      deleteQuestion: {
        request: (id) => ({ path: `/questions/${id}`, method: 'DELETE' }),
        decode: decodeEmpty,
      },
      summary: {
        request: (asOf, periodStart, ai = true) => ({
          path:
            '/summary' +
            query({ as_of: asOf, period_start: periodStart ?? undefined, ai: String(ai) }),
          timeoutMs: ai ? 375000 : 15000,
        }),
        decode: decode(decoders.summary),
      },
      trends: {
        request: (type, asOf, periodStart) => ({
          path:
            '/trends' +
            query({
              type: codes ? wireEventType(type) : type,
              as_of: asOf,
              period_start: periodStart ?? undefined,
            }),
        }),
        decode: decode(decoders.trends),
      },
      patient: { request: () => ({ path: '/patient' }), decode: decode(decoders.patient) },
      savePatient: {
        request: (body) => ({ path: '/patient', method: 'PUT', body }),
        decode: decode(decoders.patient),
      },
      loadDemo: {
        request: () => ({ path: '/demo/load', method: 'POST' }),
        decode: decode(decoders.workspace),
      },
      exitDemo: {
        request: () => ({ path: '/demo/exit', method: 'POST' }),
        decode: decode(decoders.workspace),
      },
    },
  }
}

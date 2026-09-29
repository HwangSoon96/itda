import { checkResponseWorkspace, rejectWorkspace, requestWorkspace } from './client'
import { realApi } from './itdaApi'
import type { Api } from './itdaApi'
import { apiContract } from './integration'

export { ApiError, adoptWorkspace, blockWorkspace } from './client'
export { realApi } from './itdaApi'
export type { Api } from './itdaApi'

export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'
export const apiCapabilities = USE_MOCK
  ? { workspace: true, patient: true, demo: true }
  : apiContract.capabilities

// The separate fixture module is only loaded for an explicitly selected mock run.
export const api: Api = USE_MOCK
  ? new Proxy({} as Api, {
      get:
        (_, key: keyof Api) =>
        async (...args: unknown[]) => {
          const id = key === 'health' ? null : requestWorkspace()
          const { mockApi } = await import('./mock/mockApi')
          if (id) {
            checkResponseWorkspace(id)
            if ((await mockApi.health()).workspace_id !== id) throw rejectWorkspace()
          }
          const value = await Reflect.apply(mockApi[key], mockApi, args)
          if (id) checkResponseWorkspace(id)
          return value
        },
    })
  : realApi

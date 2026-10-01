import type { HttpClientOptions } from './contract'
import { createRestContract } from './restContract'

/** Select the team's agreed routes, serialization, capabilities and job adapter here. */
export const apiContract = createRestContract({
  enumStyle: 'codes',
  envelope: 'bare',
  capabilities: { workspace: false, patient: true, demo: false },
})

const credentials = import.meta.env.VITE_API_CREDENTIALS ?? 'same-origin'
if (!['omit', 'same-origin', 'include'].includes(credentials))
  throw new Error('VITE_API_CREDENTIALS must be omit, same-origin or include')

export const httpOptions: HttpClientOptions = {
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  credentials: credentials as RequestCredentials,
  // headers: () => ({ Authorization: `Bearer ${session.accessToken}` }),
}

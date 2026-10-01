import { createHttpApi } from './httpApi'
import { apiContract, httpOptions } from './integration'

export const realApi = createHttpApi(apiContract, httpOptions)
export type { Api } from './port'

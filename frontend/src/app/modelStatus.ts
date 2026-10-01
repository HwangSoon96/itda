import type { Health } from '../api/types'

// Header status pill copy, phrased as "잇다 …중" so every state reads in the same tone.
export function modelStatusLabel(health: Health | null, connectionError: string) {
  if (connectionError) return '잇다 PC 연결 끊김'
  if (!health) return '잇다 연결 확인중'
  if (health.ai_available === true) return '잇다 모델 가동중'
  if (health.ai_available === false) return '잇다 모델 연결 대기중'
  return '잇다 모델 상태 확인중'
}

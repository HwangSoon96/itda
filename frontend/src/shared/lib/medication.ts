import type { Medication } from '../../api/types'

export const MEDICATION_CHANGE_LABELS: Record<Medication['change_type'], string> = {
  시작: '복용 시작',
  증량: '용량 늘림',
  감량: '용량 줄임',
  중단: '복용 중단',
}

export function medicationChangeLabel(value: string): string {
  return Object.hasOwn(MEDICATION_CHANGE_LABELS, value)
    ? MEDICATION_CHANGE_LABELS[value as Medication['change_type']]
    : value
}

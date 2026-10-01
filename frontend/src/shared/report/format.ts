import type { EventType, Period, Summary, SummaryRow } from '../../api/types'

export const rate = (value: number | null) =>
  value === null ? '—' : value > 0 && value < 0.01 ? '<1%' : `${Math.round(value * 100)}%`
export const weeklyCount = (value: number | null) =>
  value === null ? '—' : value > 0 && value < 0.1 ? '<0.1회' : `${value.toFixed(1)}회`
export const isChange = (row: SummaryRow) =>
  ['증가', '처음 기록', '새로 나타남'].includes(row.mark ?? '')
export const markLabel = (mark: SummaryRow['mark']) =>
  String(mark) === '처음 기록' ? '새로 나타남' : mark
export function importantRows(rows: SummaryRow[]) {
  return rows
    .filter((row) => isChange(row) || (row.type === '낙상' && row.occurrence_days > 0))
    .sort(
      (a, b) =>
        Number(b.type === '낙상') - Number(a.type === '낙상') ||
        (b.current_rate ?? 0) -
          (b.baseline_rate ?? 0) -
          ((a.current_rate ?? 0) - (a.baseline_rate ?? 0)),
    )
}
export function baselineOccurrence(row: SummaryRow, data: Summary) {
  const n = row.baseline_recorded_days ?? data.baseline_coverage?.recorded_days
  return n !== undefined && row.baseline_rate !== null
    ? `${row.baseline_occurrence_days ?? Math.round(row.baseline_rate * n)}/${n}일`
    : '—'
}
const observationLabels: Record<EventType, string> = {
  '야간 각성': '밤에 깬 일',
  '배회·출입문 시도': '서성이거나 문을 열려 한 일',
  '초조·공격': '초조하거나 공격적인 모습',
  '과민·짜증': '예민해지거나 짜증 낸 모습',
  불안: '불안해한 모습',
  '우울·무기력': '우울하거나 기운 없는 모습',
  망상: '사실과 다른 믿음을 말한 일',
  환각: '없는 것을 보거나 들었다고 한 일',
  '식사량 감소': '식사량이 줄어든 일',
  '복약 거부': '약 먹기를 거부한 일',
  '사람·장소 혼동': '사람이나 장소를 헷갈린 일',
  낙상: '넘어진 일',
}
export const observationLabel = (type: EventType) => observationLabels[type]
export function observationText(row: SummaryRow) {
  const subject = `${observationLabel(row.type)}이`
  return row.occurrence_days
    ? `${subject} ${row.occurrence_days}일 기록됐어요.`
    : `${observationLabel(row.type)}이 기록된 날은 없어요.`
}
export function comparisonText(row: SummaryRow, data: Summary) {
  const count = row.baseline_occurrence_days
  const days = row.baseline_recorded_days ?? data.baseline_coverage?.recorded_days
  return row.baseline_rate !== null && count !== undefined && days !== undefined
    ? `이전에는 기록이 있는 ${days}일 중 ${count}일`
    : '이전 기록과 비교할 수 없어요.'
}
export function coverageLabel(data: Summary) {
  return `이 기간 ${data.coverage.total_days}일 가운데 ${data.coverage.recorded_days}일에 확인된 기록이 있어요.`
}
export function readableDate(value: string, year = false) {
  return `${year ? `${Number(value.slice(0, 4))}년 ` : ''}${Number(value.slice(5, 7))}월 ${Number(value.slice(8, 10))}일`
}
export function readablePeriod(value: Period) {
  const crossYear = value.start.slice(0, 4) !== value.end.slice(0, 4)
  return `${readableDate(value.start, crossYear)} ~ ${readableDate(value.end, crossYear)}`
}
export function exclusionsOf(data: Summary) {
  return (
    data.exclusions ?? {
      pending_memo_ids: [],
      failed_memo_ids: [],
    }
  )
}
export function hasExclusions(data: Summary) {
  const excluded = exclusionsOf(data)
  return excluded.pending_memo_ids.length > 0 || excluded.failed_memo_ids.length > 0
}
export function exclusionLabel(data: Summary) {
  const value = exclusionsOf(data)
  return `확인 대기 메모 ${value.pending_memo_ids.length}건 · 정리 실패 메모 ${value.failed_memo_ids.length}건`
}

export const shortDate = (value: string) => value.slice(5).replace('-', '/')
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : '다시 불러와 주세요.'
export const dateRange = (value: { start: string; end: string }) => `${value.start} ~ ${value.end}`

import type { EventCard, EventType, MemoResult, Period, Summary } from '../../api/types'

export interface EvidenceSelection {
  title: string
  ids: number[]
  dates: string[]
  type?: EventType
  period?: Period
  kind?: 'observation' | 'coverage'
}
export interface ObservationEvidence {
  memo: MemoResult
  event: EventCard
}
export function matchingEvidence(
  memos: MemoResult[],
  selection: EvidenceSelection,
): ObservationEvidence[] {
  return memos
    .filter(
      (memo) =>
        memo.status === '확인 완료' &&
        (selection.ids.length
          ? selection.ids.includes(memo.memo_id)
          : selection.dates.includes(memo.record_date)),
    )
    .flatMap((memo) =>
      memo.events
        .filter((event) => !selection.type || event.type === selection.type)
        .map((event) => ({ memo, event })),
    )
    .sort(
      (a, b) =>
        b.memo.record_date.localeCompare(a.memo.record_date) || b.memo.memo_id - a.memo.memo_id,
    )
}
export function currentOccurrence(item: ObservationEvidence, period?: Period) {
  return (
    item.event.status === '있었음' &&
    (!period || (item.memo.record_date >= period.start && item.memo.record_date <= period.end))
  )
}
export function representativeEvidence(
  data: Summary,
  memos: MemoResult[],
  type: EventType,
  ids: number[],
  dates: string[],
) {
  return matchingEvidence(memos, { title: type, type, ids, dates }).find((item) =>
    currentOccurrence(item, data.period),
  )
}

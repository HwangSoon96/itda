import type { EventType, MemoResult, Question, Summary } from '../../api/types'

const labels: Record<EventType, string> = {
  '야간 각성': '밤에 깬 일',
  '배회·출입문 시도': '돌아다니거나 밖으로 나가려 한 일',
  '초조·공격': '초조해하거나 공격적인 모습',
  '과민·짜증': '짜증을 내신 일',
  불안: '불안해하신 일',
  '우울·무기력': '기운이 없거나 우울해하신 일',
  망상: '사실과 다른 이야기를 하신 일',
  환각: '다른 사람에게 보이지 않거나 들리지 않는 것을 말씀하신 일',
  '식사량 감소': '식사를 적게 드신 일',
  '복약 거부': '약을 드시지 않으려 한 일',
  '사람·장소 혼동': '사람이나 장소를 헷갈리신 일',
  낙상: '넘어지신 일',
}
export function questionInPeriod(question: Question, period: Summary['period']) {
  // A question belongs to the period containing its creation date.
  const date = question.created_at.slice(0, 10)
  return date >= period.start && date <= period.end
}
export interface TalkingPoint {
  type: EventType
  title: string
  text: string
  quote: string
  date: string
  memoId: number
}
/** Confirmed observations belong to the date selected on their memo. */
export function buildTalkingPoints(summary: Summary, memos: MemoResult[]): TalkingPoint[] {
  const rows = summary.rows
    .filter((row) => row.occurrence_days > 0)
    .sort(
      (a, b) =>
        Number(b.type === '낙상') - Number(a.type === '낙상') ||
        Number(['증가', '새로 나타남'].includes(b.mark ?? '')) -
          Number(['증가', '새로 나타남'].includes(a.mark ?? '')) ||
        b.occurrence_days - a.occurrence_days,
    )
  return rows
    .flatMap((row) => {
      const events = memos
        .filter(
          (memo) =>
            memo.status === '확인 완료' &&
            memo.record_date >= summary.period.start &&
            memo.record_date <= summary.period.end,
        )
        .flatMap((memo) =>
          memo.events
            .filter(
              (event) =>
                event.type === row.type &&
                event.status === '있었음' &&
                Boolean(event.evidence.trim()) &&
                memo.text.includes(event.evidence),
            )
            .map((event) => ({ ...event, memoId: memo.memo_id, recordDate: memo.record_date })),
        )
        .sort((a, b) => b.recordDate.localeCompare(a.recordDate) || b.memoId - a.memoId)
      if (!events.length) return []
      const event = events[0]
      return [
        {
          type: row.type,
          title: labels[row.type],
          text: `${labels[row.type]}에 대해 상담하고 싶어요. 집에서 어떤 점을 살펴보면 좋을까요?`,
          quote: event.evidence,
          date: event.recordDate,
          memoId: event.memoId,
        },
      ]
    })
    .slice(0, 3)
}

import { ChevronDown, ChevronRight } from 'lucide-react'
import type { Visit } from '../../api/types'

export const formatVisitDate = (date: string) =>
  new Date(`${date.slice(0, 10)}T12:00:00`).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

export function VisitHistory({
  visits,
  today,
  disabled,
  onManage,
  onComplete,
}: {
  visits: Visit[]
  today: string
  disabled: boolean
  onManage: (visit: Visit) => void
  onComplete: (visit: Visit) => void
}) {
  const planned = visits
    .filter((visit) => visit.status === '예정')
    .sort((a, b) => a.visit_date.localeCompare(b.visit_date))
  const upcoming = planned.filter((visit) => visit.visit_date >= today)
  const overdue = planned.filter((visit) => visit.visit_date < today)
  const [recent, ...older] = visits
    .filter((visit) => visit.status === '완료' && visit.visit_date <= today)
    .sort((a, b) => b.visit_date.localeCompare(a.visit_date))

  const row = (visit: Visit) => (
    <li key={visit.id} className="mvp-visit-row">
      <button
        type="button"
        className="mvp-history-item"
        aria-label={`${formatVisitDate(visit.visit_date)} 진료일 관리`}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => onManage(visit)}
      >
        <time dateTime={visit.visit_date}>{formatVisitDate(visit.visit_date)}</time>
        <ChevronRight size={18} aria-hidden="true" />
      </button>
      {visit.status === '예정' && visit.visit_date <= today && (
        <button
          type="button"
          className="mvp-visit-complete"
          aria-label={`${formatVisitDate(visit.visit_date)} 진료 완료`}
          disabled={disabled}
          onClick={() => onComplete(visit)}
        >
          진료 완료
        </button>
      )}
    </li>
  )

  return (
    <div className="mvp-visit-history">
      <section className="mvp-visit-group" aria-labelledby="schedule-upcoming-heading">
        <h3 id="schedule-upcoming-heading">다음 진료</h3>
        {upcoming.length ? (
          <ul className="mvp-visit-rows">{upcoming.map(row)}</ul>
        ) : (
          <p className="mvp-visit-empty">예정된 진료가 없어요.</p>
        )}
      </section>
      {overdue.length > 0 && (
        <section
          className="mvp-visit-group mvp-visit-overdue"
          aria-labelledby="schedule-overdue-heading"
        >
          <h3 id="schedule-overdue-heading">진료받으셨나요?</h3>
          <ul className="mvp-visit-rows">{overdue.map(row)}</ul>
        </section>
      )}
      <section className="mvp-visit-group" aria-labelledby="schedule-recent-heading">
        <h3 id="schedule-recent-heading">최근 받은 진료</h3>
        {recent ? (
          <>
            <ul className="mvp-visit-rows">{row(recent)}</ul>
            <p className="mvp-visit-summary-hint">기본 요약은 최근 진료일부터 시작해요.</p>
          </>
        ) : (
          <p className="mvp-visit-empty">진료받은 날을 등록해 주세요.</p>
        )}
      </section>
      {older.length > 0 && (
        <details className="mvp-visit-older">
          <summary>
            지난 진료 {older.length}건 보기
            <ChevronDown size={18} aria-hidden="true" />
          </summary>
          <ul className="mvp-visit-rows">{older.map(row)}</ul>
        </details>
      )}
    </div>
  )
}

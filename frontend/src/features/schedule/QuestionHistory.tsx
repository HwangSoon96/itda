import { useEffect, useRef } from 'react'
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'
import type { Period, Question } from '../../api/types'
import { questionInPeriod } from '../../shared/lib/visitPreparation'
import { formatVisitDate as formatDate } from './VisitHistory'

export function QuestionHistory({
  questions,
  period,
  loading,
  disabled,
  revealId,
  onManage,
  onRetry,
}: {
  questions: Question[]
  period: Period | null
  loading: boolean
  disabled: boolean
  revealId: number | null
  onManage: (question: Question) => void
  onRetry: () => void
}) {
  const container = useRef<HTMLElement>(null)
  const revealedId = useRef<number | null>(null)
  const sorted = [...questions].sort(
    (a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id,
  )
  const included = period ? sorted.filter((question) => questionInPeriod(question, period)) : sorted
  const others = period ? sorted.filter((question) => !questionInPeriod(question, period)) : []
  const heading = period ? '요약지에 담길 질문' : '저장한 질문'

  useEffect(() => {
    // Wait for grouping to settle before revealing a newly saved question.
    if (loading || revealId === null || revealedId.current === revealId) return
    const row = container.current?.querySelector<HTMLElement>(`[data-question-id="${revealId}"]`)
    if (!row) return
    const frame = requestAnimationFrame(() => {
      const details = row.closest('details')
      if (details) details.open = true
      row.focus({ preventScroll: true })
      row.scrollIntoView({ block: 'nearest' })
      revealedId.current = revealId
    })
    return () => cancelAnimationFrame(frame)
  }, [revealId, questions, period, loading])

  const row = (question: Question) => (
    <li key={question.id} className="mvp-question-row" data-question-id={question.id} tabIndex={-1}>
      <button
        type="button"
        className="mvp-history-item"
        aria-label={`${formatDate(question.created_at)} ${question.text.slice(0, 25)} 관리`}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => onManage(question)}
      >
        <span className="mvp-question-row-content">
          <time dateTime={question.created_at}>{formatDate(question.created_at)}</time>
          <span className="mvp-question-row-text">{question.text}</span>
        </span>
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </li>
  )

  return (
    <section
      className="mvp-question-history"
      aria-labelledby="schedule-question-history-heading"
      ref={container}
    >
      <header className="mvp-question-history-heading">
        <h3 id="schedule-question-history-heading">{heading}</h3>
        {period && (
          <p className="mvp-question-period">
            <time dateTime={period.start}>{period.start.replaceAll('-', '.')}</time>
            <span>–</span>
            <time dateTime={period.end}>{period.end.replaceAll('-', '.')}</time>
          </p>
        )}
      </header>
      {!period && (
        <div className="mvp-question-period-status" role="status">
          <p>{loading ? '요약 기간 확인 중…' : '요약지 포함 여부를 확인하지 못했어요.'}</p>
          {!loading && (
            <button
              type="button"
              className="mvp-question-retry"
              disabled={disabled}
              onClick={onRetry}
            >
              <RotateCcw size={16} aria-hidden="true" />
              다시 확인하기
            </button>
          )}
        </div>
      )}
      {included.length ? (
        <ul className="mvp-question-rows" aria-label={`${heading} 목록`}>
          {included.map(row)}
        </ul>
      ) : !loading ? (
        <p className="mvp-sc-hint">
          {questions.length ? '이 기간에 저장한 질문이 없어요.' : '아직 저장한 질문이 없어요.'}
        </p>
      ) : null}
      {others.length > 0 && (
        <details className="mvp-question-others">
          <summary>
            다른 기간의 질문 {others.length}개 보기
            <ChevronDown size={18} aria-hidden="true" />
          </summary>
          <ul className="mvp-question-rows" aria-label="다른 기간의 질문 목록">
            {others.map(row)}
          </ul>
        </details>
      )}
    </section>
  )
}

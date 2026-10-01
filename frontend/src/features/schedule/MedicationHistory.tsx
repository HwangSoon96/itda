import { useEffect, useRef } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { Medication } from '../../api/types'
import { medicationChangeLabel } from '../../shared/lib/medication'
import { formatVisitDate as formatDate } from './VisitHistory'

export function MedicationHistory({
  medications,
  disabled,
  revealId,
  onManage,
}: {
  medications: Medication[]
  disabled: boolean
  revealId: number | null
  onManage: (medication: Medication) => void
}) {
  const container = useRef<HTMLElement>(null)
  const revealedId = useRef<number | null>(null)
  const sorted = [...medications].sort(
    (a, b) => b.change_date.localeCompare(a.change_date) || b.id - a.id,
  )
  const recent = sorted.slice(0, 3)
  const older = sorted.slice(3)

  useEffect(() => {
    if (revealId === null || revealedId.current === revealId) return
    const row = container.current?.querySelector<HTMLElement>(`[data-medication-id="${revealId}"]`)
    if (!row) return
    const frame = requestAnimationFrame(() => {
      const details = row.closest('details')
      if (details) details.open = true
      row.focus({ preventScroll: true })
      row.scrollIntoView({ block: 'nearest' })
      revealedId.current = revealId
    })
    return () => cancelAnimationFrame(frame)
  }, [revealId, medications])

  const row = (medication: Medication) => (
    <li
      key={medication.id}
      className="mvp-medication-row"
      data-medication-id={medication.id}
      tabIndex={-1}
    >
      <button
        type="button"
        className="mvp-history-item"
        aria-label={`${formatDate(medication.change_date)} ${medication.name} ${medicationChangeLabel(medication.change_type)} 관리`}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => onManage(medication)}
      >
        <span className="mvp-medication-row-content">
          <span className="mvp-medication-row-title">
            <strong>{medication.name}</strong>
            {' · '}
            {medicationChangeLabel(medication.change_type)}
          </span>
          <time dateTime={medication.change_date}>{formatDate(medication.change_date)}</time>
        </span>
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </li>
  )

  return (
    <section
      className="mvp-medication-history"
      aria-labelledby="schedule-medication-history-heading"
      ref={container}
    >
      <h3 id="schedule-medication-history-heading">최근 변경 기록</h3>
      {recent.length ? (
        <ul className="mvp-medication-rows">{recent.map(row)}</ul>
      ) : (
        <p className="mvp-sc-hint">아직 저장한 약 변경이 없어요.</p>
      )}
      {older.length > 0 && (
        <details className="mvp-medication-older">
          <summary>
            지난 약 변경 {older.length}건 보기
            <ChevronDown size={18} aria-hidden="true" />
          </summary>
          <ul className="mvp-medication-rows">{older.map(row)}</ul>
        </details>
      )}
    </section>
  )
}

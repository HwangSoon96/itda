import { useEffect, useRef, useState } from 'react'
import { localToday, openDatePicker } from '../lib/date'
import { ReportFeedback } from './ReportFeedback'

function completeDate(value: string) {
  // Native date fields can emit zero-padded partial years while a year is being typed.
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function PeriodControls({
  asOf,
  periodStart,
  defaultStart,
  defaultEnd,
  setPeriod,
  setPeriodStart,
  resetPeriod,
  isFixed,
  notice,
  editRequest = 0,
  active = true,
  onPendingChange,
}: {
  asOf: string
  periodStart: string | null
  defaultStart?: string
  /** Shown while no end date is pinned. `null` leaves the field blank; omitted shows `asOf`. */
  defaultEnd?: string | null
  setPeriod: (value: { asOf: string; periodStart: string | null }) => void
  setPeriodStart?: (value: string | null) => void
  resetPeriod: () => void
  isFixed?: boolean
  summary?: boolean
  notice?: string
  editRequest?: number
  active?: boolean
  onPendingChange?: (pending: boolean) => void
}) {
  const start = periodStart ?? defaultStart
  const end = isFixed || defaultEnd === undefined ? asOf : (defaultEnd ?? '')
  const [draftStart, setDraftStart] = useState(start ?? '')
  const [draftEnd, setDraftEnd] = useState(end)
  const [formNotice, setFormNotice] = useState('')
  const startInput = useRef<HTMLInputElement>(null)
  const previousSelection = useRef({ asOf, periodStart, active, start, end })
  useEffect(() => {
    const previous = previousSelection.current
    previousSelection.current = { asOf, periodStart, active, start, end }
    if (
      previous.asOf !== asOf ||
      previous.periodStart !== periodStart ||
      previous.active !== active
    ) {
      setDraftStart(start ?? '')
      setDraftEnd(end)
    } else {
      // A late default period can fill an untouched field without replacing an edit.
      if (previous.start !== start)
        setDraftStart((draft) => (draft === (previous.start ?? '') ? (start ?? '') : draft))
      if (previous.end !== end) setDraftEnd((draft) => (draft === previous.end ? end : draft))
    }
    if (!active) setFormNotice('')
  }, [start, end, asOf, periodStart, active])
  useEffect(() => {
    if (!editRequest || !active) return
    const frame = requestAnimationFrame(() => startInput.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [editRequest, active])
  const invalidOrder = Boolean(draftStart && draftEnd && draftStart > draftEnd)
  const futureStart = completeDate(draftStart) && draftStart > localToday()
  const changed = draftStart !== (start ?? '') || draftEnd !== end
  // The visit-based default end may be blank or in the future. Leaving it untouched
  // changes only the start and keeps the summary following today.
  const keepDefaultEnd = Boolean(setPeriodStart) && end !== asOf && draftEnd === end
  useEffect(() => {
    onPendingChange?.(active && changed)
  }, [active, changed, onPendingChange])
  useEffect(() => {
    if (!active || !changed || !completeDate(draftStart) || draftStart > localToday()) return
    if (
      !keepDefaultEnd &&
      (!completeDate(draftEnd) || draftStart > draftEnd || draftEnd > localToday())
    )
      return
    // Coalesce edits to both dates and ignore incomplete ranges while the user types.
    const timer = setTimeout(() => {
      if (keepDefaultEnd) setPeriodStart?.(draftStart)
      else setPeriod({ asOf: draftEnd, periodStart: draftStart })
    }, 400)
    return () => clearTimeout(timer)
  }, [active, changed, keepDefaultEnd, draftStart, draftEnd, setPeriod, setPeriodStart])
  function cancelChanges() {
    setDraftStart(start ?? '')
    setDraftEnd(end)
    setFormNotice('')
    startInput.current?.focus()
  }
  return (
    <section className="mvp-period-choice" aria-label="보고서 기간">
      <div
        className="mvp-report-period-controls"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            cancelChanges()
          }
        }}
      >
        <label>
          <input
            ref={startInput}
            type="date"
            onClick={(e) => openDatePicker(e.currentTarget)}
            aria-label="시작 날짜"
            className="itda-date-input"
            value={draftStart}
            max={draftEnd || localToday()}
            onChange={(event) => {
              setDraftStart(event.target.value)
              setFormNotice('')
            }}
          />
        </label>
        <span className="mvp-period-separator" aria-hidden="true">
          ~
        </span>
        <label>
          <input
            type="date"
            onClick={(e) => openDatePicker(e.currentTarget)}
            aria-label="마지막 날짜"
            className="itda-date-input"
            value={draftEnd}
            min={draftStart || undefined}
            max={keepDefaultEnd && end > localToday() ? end : localToday()}
            onChange={(event) => {
              const value = event.target.value
              if (value > localToday() && value !== end) {
                setDraftEnd(localToday())
                setFormNotice(`미래 날짜는 사용할 수 없어 오늘(${localToday()})로 바꿨어요.`)
              } else {
                setDraftEnd(value)
                setFormNotice('')
              }
            }}
          />
        </label>
        <div className="mvp-period-actions">
          {(periodStart || isFixed) && (
            <button
              type="button"
              className="button outline"
              onClick={() => {
                resetPeriod()
                cancelChanges()
              }}
              title="직전 진료일부터 오늘까지. 지난 진료가 없으면 첫 기록부터 다음 진료일까지 보여 드려요."
            >
              기본 기간으로 돌아가기
            </button>
          )}
        </div>
        {futureStart ? (
          <p role="alert">미래 날짜는 사용할 수 없어요.</p>
        ) : invalidOrder ? (
          <p role="alert">시작 날짜는 마지막 날짜보다 늦을 수 없어요.</p>
        ) : null}
      </div>
      <ReportFeedback
        active={active}
        title="기간을 확인해 주세요"
        tone="info"
        message={formNotice || notice || ''}
      />
    </section>
  )
}

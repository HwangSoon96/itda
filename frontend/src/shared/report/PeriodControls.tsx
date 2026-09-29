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
  setPeriod,
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
  setPeriod: (value: { asOf: string; periodStart: string | null }) => void
  resetPeriod: () => void
  isFixed?: boolean
  summary?: boolean
  notice?: string
  editRequest?: number
  active?: boolean
  onPendingChange?: (pending: boolean) => void
}) {
  const start = periodStart ?? defaultStart
  const [draftStart, setDraftStart] = useState(start ?? '')
  const [draftEnd, setDraftEnd] = useState(asOf)
  const [formNotice, setFormNotice] = useState('')
  const startInput = useRef<HTMLInputElement>(null)
  const previousSelection = useRef({ asOf, periodStart, active, start })
  useEffect(() => {
    const previous = previousSelection.current
    previousSelection.current = { asOf, periodStart, active, start }
    if (
      previous.asOf !== asOf ||
      previous.periodStart !== periodStart ||
      previous.active !== active
    ) {
      setDraftStart(start ?? '')
      setDraftEnd(asOf)
    } else if (previous.start !== start) {
      // A late default period can fill an untouched field without replacing an edit.
      setDraftStart((draft) => (draft === (previous.start ?? '') ? (start ?? '') : draft))
    }
    if (!active) setFormNotice('')
  }, [start, asOf, periodStart, active])
  useEffect(() => {
    if (!editRequest || !active) return
    const frame = requestAnimationFrame(() => startInput.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [editRequest, active])
  const invalidOrder = Boolean(draftStart && draftEnd && draftStart > draftEnd)
  const futureStart = completeDate(draftStart) && draftStart > localToday()
  const changed = draftStart !== (start ?? '') || draftEnd !== asOf
  useEffect(() => {
    onPendingChange?.(active && changed)
  }, [active, changed, onPendingChange])
  useEffect(() => {
    if (
      !active ||
      !changed ||
      !completeDate(draftStart) ||
      !completeDate(draftEnd) ||
      draftStart > draftEnd ||
      draftEnd > localToday()
    )
      return
    // Coalesce edits to both dates and ignore incomplete ranges while the user types.
    const timer = setTimeout(() => {
      setPeriod({ asOf: draftEnd, periodStart: draftStart })
    }, 400)
    return () => clearTimeout(timer)
  }, [active, changed, draftStart, draftEnd, setPeriod])
  function cancelChanges() {
    setDraftStart(start ?? '')
    setDraftEnd(asOf)
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
            max={localToday()}
            onChange={(event) => {
              const value = event.target.value
              if (value > localToday()) {
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
              title="마지막 완료 진료일부터 오늘까지. 완료한 진료가 없으면 첫 기록부터 보여 드려요."
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

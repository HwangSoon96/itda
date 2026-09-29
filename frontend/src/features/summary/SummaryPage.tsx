import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Printer, RefreshCw, X } from 'lucide-react'
import { BrandLogo } from '../../shared/ui/BrandLogo'
import { api } from '../../api'
import { Modal } from '../../shared/ui'
import type { Health, MemoResult, Summary, SummaryRow, Trends } from '../../api/types'
import {
  currentOccurrence,
  dateRange,
  ExcludedRecords,
  hasExclusions,
  isChange,
  markLabel,
  matchingEvidence,
  PeriodControls,
  ReportFeedback,
  rate,
  readableDate,
  TrendChart,
  useReportMemos,
  useSummary,
  useVisitPeriod,
  weeklyCount,
} from '../../shared/report'
import type { EvidenceSelection } from '../../shared/report'
import { reportHref, useReportSelection } from '../../shared/lib/reportSelection'
import { medicationChangeLabel } from '../../shared/lib/medication'
import '../../shared/report/report.css'
import './summary.css'
import { summaryTrendTypes } from './model'

type SourceSelection = EvidenceSelection & {
  quote?: string
  types?: Summary['rows'][number]['type'][]
}
function sourceForSentence(data: Summary, index: number): SourceSelection {
  const sentence = data.sentences[index]
  const types =
    sentence.types ??
    data.rows.filter((row) => sentence.text.includes(row.type)).map((row) => row.type)
  const legacyScope = sentence.text.startsWith('기준 구간 전체 ')
    ? 'baseline'
    : sentence.text.startsWith('기준 구간 대비 증가 표시가 붙은 항목 없음.') ||
        sentence.text.startsWith('비교할 기록이 부족해 증가 표시를 계산하지 않음.')
      ? 'comparison'
      : 'current'
  const scope = sentence.scope ?? legacyScope
  const coverage = !types.length
  const period =
    scope === 'baseline'
      ? (data.baseline ?? data.period)
      : scope === 'comparison' && data.baseline
        ? { start: data.baseline.start, end: data.period.end }
        : data.period
  return {
    title:
      types.length === 1
        ? `${types[0]} 관련 기록`
        : scope === 'baseline'
          ? '이전 기간 관련 기록'
          : `관련 기록 ${index + 1}`,
    quote: sentence.text,
    type: types.length === 1 ? types[0] : undefined,
    types,
    kind: coverage ? 'coverage' : 'observation',
    ids: sentence.memo_ids ?? [],
    dates: sentence.evidence_dates,
    period,
  }
}
function orderedRows(data: Summary) {
  return [...data.rows].sort((a, b) => Number(isChange(b)) - Number(isChange(a)))
}
function RowMark({ row, data }: { row: SummaryRow; data: Summary }) {
  if (row.type === '낙상' && data.falls.length)
    return (
      <span className="v2-fall-dates">
        {data.falls.map((date) => readableDate(date)).join(', ')}
      </span>
    )
  return row.mark ? (
    <span
      className={`mvp-print-mark${isChange(row) ? ' is-change' : ''}${row.mark === '새로 나타남' ? ' is-new' : ''}`}
    >
      {markLabel(row.mark)}
    </span>
  ) : (
    <span>—</span>
  )
}
function ChangesTable({
  data,
  rows,
  onEvidence,
}: {
  data: Summary
  rows: SummaryRow[]
  onEvidence?: (value: SourceSelection) => void
}) {
  const select = (row: SummaryRow) =>
    onEvidence?.({
      title: `${row.type} 관련 기록`,
      quote: `${row.type}: 기준 구간 ${rate(row.baseline_rate)} → 이번 구간 ${rate(row.current_rate)}`,
      type: row.type,
      kind: 'observation',
      period: data.period,
      ids: row.memo_ids,
      dates: row.evidence_dates,
    })
  return (
    <table className="v2-summary-table">
      <thead>
        <tr>
          <th>유형</th>
          <th>기준 구간</th>
          <th>이번 구간</th>
          <th>주당 환산</th>
          <th>표시</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.type}>
            <th>
              {onEvidence && (row.memo_ids.length || row.evidence_dates.length) ? (
                <button onClick={() => select(row)} aria-label={`${row.type} 관련 기록 보기`}>
                  {row.type}
                </button>
              ) : (
                row.type
              )}
            </th>
            <td>{rate(row.baseline_rate)}</td>
            <td>
              <strong>{rate(row.current_rate)}</strong>
            </td>
            <td>{weeklyCount(row.weekly_count)}</td>
            <td>
              <RowMark row={row} data={data} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
function PaperHeader({ data, detail = false }: { data: Summary; detail?: boolean }) {
  return (
    <header className="v2-paper-header">
      {detail ? (
        <h2>경과 요약지 · 상세</h2>
      ) : (
        <div className="v2-paper-brand">
          <BrandLogo />
          <div>
            <p>잇다 · 보호자 관찰 기록 정리</p>
            <h2>경과 요약지</h2>
          </div>
        </div>
      )}
      <dl>
        <div>
          <dt>환자</dt>
          <dd>{data.patient_alias}</dd>
        </div>
        <div>
          <dt>이번 구간</dt>
          <dd>{dateRange(data.period)}</dd>
        </div>
        {!detail && (
          <>
            <div>
              <dt>기준 구간</dt>
              <dd>{data.baseline ? dateRange(data.baseline) : '비교할 기록 없음'}</dd>
            </div>
            <div>
              <dt>기록 커버리지</dt>
              <dd>
                <strong>
                  {data.coverage.recorded_days}일 / {data.coverage.total_days}일
                </strong>
              </dd>
            </div>
          </>
        )}
      </dl>
    </header>
  )
}
function CoreSummary({
  data,
  onEvidence,
}: {
  data: Summary
  onEvidence?: (value: SourceSelection) => void
}) {
  return (
    <section className="v2-report-section v2-core-summary">
      <h3>
        핵심 요약{' '}
        <span>{data.summary_source === 'llm' ? 'AI가 작성한 요약' : '자동 정리된 요약'}</span>
      </h3>
      <ol>
        {data.sentences.map((sentence, index) => (
          <li key={index}>
            {onEvidence && (sentence.memo_ids?.length || sentence.evidence_dates.length) ? (
              <button
                onClick={() => onEvidence(sourceForSentence(data, index))}
                aria-label={`${sourceForSentence(data, index).title} 보기`}
              >
                {sentence.text}
              </button>
            ) : (
              sentence.text
            )}
          </li>
        ))}
      </ol>
      {!data.sentences.length && <p>확인한 관찰 기록이 없습니다.</p>}
    </section>
  )
}
function Questions({ data }: { data: Summary }) {
  return (
    <section className="v2-report-section v2-questions">
      <h3>보호자가 묻고 싶은 것</h3>
      {data.questions.length ? (
        <ol>
          {data.questions.map((question, index) => (
            <li key={index}>{question}</li>
          ))}
        </ol>
      ) : (
        <p>등록한 질문 없음</p>
      )}
    </section>
  )
}
function MedicationChanges({ data }: { data: Summary }) {
  const items = [...data.medications].sort((a, b) => a.date.localeCompare(b.date))
  return (
    <section className="v2-report-section v2-chronology v2-medication-history" aria-label="약 변경">
      <h3>약 변경</h3>
      {items.length ? (
        <ul>
          {items.map((item, index) => (
            <li key={index}>
              <time dateTime={item.date}>{item.date}</time>
              <span>
                {item.name} · {medicationChangeLabel(item.change_type)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p>이 기간에 약 변경 기록 없음</p>
      )}
    </section>
  )
}
function Falls({ data }: { data: Summary }) {
  const dates = [...data.falls].sort((a, b) => a.localeCompare(b))
  return (
    <section className="v2-report-section v2-chronology v2-fall-history" aria-label="낙상">
      <h3>낙상</h3>
      {dates.length ? (
        <ul>
          {dates.map((date, index) => (
            <li key={index}>
              <time dateTime={date}>{date}</time>
              <span>낙상</span>
            </li>
          ))}
        </ul>
      ) : (
        <p>이 기간에 확인된 낙상 기록 없음</p>
      )}
    </section>
  )
}
function Charts({ data, charts }: { data: Summary; charts: Trends[] }) {
  return (
    <section className="v2-report-section v2-report-charts">
      <h3>
        주간 추이{' '}
        <span>{data.baseline ? '기준 구간 대비 차이가 큰 유형' : '발생일 비율이 높은 유형'}</span>
      </h3>
      <p className="v2-paper-note">회색 점: 주 기록일 4일 미만 · 점선: 진료일·약 변경일</p>
      {charts.length ? (
        charts.map((chart) => {
          const row = data.rows.find((row) => row.type === chart.type)
          return (
            <div className="v2-report-chart" key={chart.type}>
              <h4>
                {chart.type}: 기준 구간 {rate(row?.baseline_rate ?? null)} → 이번 구간{' '}
                {rate(row?.current_rate ?? null)}
              </h4>
              <TrendChart data={chart} compact simple />
            </div>
          )
        })
      ) : (
        <p className="v2-empty-chart">추이를 표시할 기록이 부족합니다.</p>
      )}
    </section>
  )
}
function Footer({ data }: { data: Summary }) {
  return (
    <footer className="v2-paper-footer">
      보호자의 PC 안에서 생성한 관찰 기록 요약 · {data.period.end}
    </footer>
  )
}
function SummarySheets({
  data,
  charts,
  deferredRows,
  onEvidence,
}: {
  data: Summary
  charts: Trends[]
  deferredRows: string[]
  onEvidence?: (value: SourceSelection) => void
}) {
  const rows = orderedRows(data)
  return (
    <>
      <article className="v2-paper v2-page-core" aria-label="보호자 관찰 경과 요약">
        <div className="v2-core-content">
          <PaperHeader data={data} />
          <p className="v2-paper-disclaimer">{data.disclaimer}</p>
          <CoreSummary data={data} onEvidence={onEvidence} />
          <section className="v2-report-section">
            <h3>영역별 변화</h3>
            <ChangesTable
              data={data}
              rows={rows.filter((row) => !deferredRows.includes(row.type))}
              onEvidence={onEvidence}
            />
            <p className="v2-paper-note">
              {data.basis_note ??
                '기록일 중 발생일의 비율입니다. 주당 환산은 기록일당 평균 횟수에 7을 곱한 값입니다.'}
            </p>
          </section>
          <Questions data={data} />
        </div>
        <Footer data={data} />
      </article>
      <article className="v2-paper v2-page-detail" aria-label="보호자 관찰 경과 상세">
        <PaperHeader data={data} detail />
        <Charts data={data} charts={charts} />
        <div className="v2-detail-bottom">
          <MedicationChanges data={data} />
          <Falls data={data} />
          {deferredRows.length > 0 && (
            <section className="v2-report-section">
              <h3>첫 장에서 넘긴 유형</h3>
              <ChangesTable
                data={data}
                rows={rows.filter((row) => deferredRows.includes(row.type))}
                onEvidence={onEvidence}
              />
            </section>
          )}
        </div>
        <Footer data={data} />
      </article>
    </>
  )
}
function MobileSummary({
  data,
  charts,
  onEvidence,
}: {
  data: Summary
  charts: Trends[]
  onEvidence: (value: SourceSelection) => void
}) {
  return (
    <div className="v2-mobile-summary">
      <div className="v2-mobile-metadata">
        <PaperHeader data={data} />
        <p className="v2-paper-disclaimer">{data.disclaimer}</p>
      </div>
      <CoreSummary data={data} onEvidence={onEvidence} />
      <section className="v2-mobile-changes">
        <h3>영역별 변화</h3>
        {orderedRows(data).map((row) => (
          <button
            key={row.type}
            className="v2-mobile-change"
            disabled={!row.memo_ids.length && !row.evidence_dates.length}
            onClick={() =>
              onEvidence({
                title: `${row.type} 관련 기록`,
                type: row.type,
                quote: `${row.type}: 기준 구간 ${rate(row.baseline_rate)} → 이번 구간 ${rate(row.current_rate)}`,
                period: data.period,
                ids: row.memo_ids,
                dates: row.evidence_dates,
              })
            }
          >
            <span className="v2-mobile-change-name">
              {row.type}
              <RowMark row={row} data={data} />
            </span>
            <span className="v2-mobile-change-values">
              <span>기준 {rate(row.baseline_rate)}</span>
              <span aria-hidden="true">→</span>
              <strong>이번 {rate(row.current_rate)}</strong>
              <span>주 {weeklyCount(row.weekly_count)}</span>
            </span>
          </button>
        ))}
        <p className="v2-paper-note">{data.basis_note}</p>
      </section>
      <Questions data={data} />
      <Charts data={data} charts={charts} />
      <MedicationChanges data={data} />
      <Falls data={data} />
    </div>
  )
}
function HighlightedText({ text, phrases }: { text: string; phrases: string[] }) {
  const phrasesInText = phrases
    .filter((phrase) => phrase && text.includes(phrase))
    .sort((a, b) => b.length - a.length)
  if (!phrasesInText.length) return <>{text}</>
  const pieces: { text: string; mark: boolean }[] = []
  let cursor = 0
  while (cursor < text.length) {
    const matches = phrasesInText
      .map((phrase) => ({ phrase, index: text.indexOf(phrase, cursor) }))
      .filter((item) => item.index >= 0)
      .sort((a, b) => a.index - b.index)
    const match = matches[0]
    if (!match) {
      pieces.push({ text: text.slice(cursor), mark: false })
      break
    }
    if (match.index > cursor) pieces.push({ text: text.slice(cursor, match.index), mark: false })
    pieces.push({ text: match.phrase, mark: true })
    cursor = match.index + match.phrase.length
  }
  return (
    <>
      {pieces.map((piece, index) =>
        piece.mark ? <mark key={index}>{piece.text}</mark> : <span key={index}>{piece.text}</span>,
      )}
    </>
  )
}
function SourceContent({
  selection,
  memos,
  loading,
  error,
  retry,
}: {
  selection: SourceSelection | null
  memos: MemoResult[]
  loading: boolean
  error: string
  retry: () => void
}) {
  const [visible, setVisible] = useState(3)
  useEffect(() => setVisible(3), [selection])
  const relevant = selection
    ? matchingEvidence(memos, selection).filter(
        (item) => !selection.types?.length || selection.types.includes(item.event.type),
      )
    : []
  const selectedMemos = selection
    ? memos.filter(
        (memo) =>
          memo.status === '확인 완료' &&
          (selection.ids.length
            ? selection.ids.includes(memo.memo_id)
            : selection.dates.includes(memo.record_date)),
      )
    : []
  const selected = selectedMemos
    .map((memo) => {
      const events = relevant.filter((item) => item.memo.memo_id === memo.memo_id)
      const current = events.filter((item) => currentOccurrence(item, selection?.period))
      return { memo, events, current }
    })
    .filter((item) =>
      selection?.kind === 'coverage'
        ? !selection.period ||
          (item.memo.record_date >= selection.period.start &&
            item.memo.record_date <= selection.period.end)
        : item.events.length || !item.memo.events.length,
    )
    .sort(
      (a, b) =>
        Number(b.current.length > 0) - Number(a.current.length > 0) ||
        b.memo.record_date.localeCompare(a.memo.record_date) ||
        b.memo.memo_id - a.memo.memo_id,
    )
  return (
    <>
      {selection?.quote && <p className="v2-source-quote">{selection.quote}</p>}
      {loading ? (
        <p role="status">근거 원문을 불러오고 있어요…</p>
      ) : error ? (
        <div role="alert">
          <p>근거 원문을 불러오지 못했어요.</p>
          <button className="button outline" onClick={retry}>
            다시 불러오기
          </button>
        </div>
      ) : !selection ? (
        <p className="v2-source-empty">요약 문장이나 유형을 누르면 근거 원문이 보여요.</p>
      ) : selected.length ? (
        <>
          <div className="v2-source-list">
            {selected.slice(0, visible).map(({ memo, events, current }) => (
              <article key={memo.memo_id}>
                <p className="v2-source-date">
                  <time dateTime={memo.record_date}>{readableDate(memo.record_date)}</time>
                </p>
                {selection.kind !== 'coverage' && events.length > 0 && !current.length && (
                  <span className="v2-source-other">
                    {events.every((item) => item.event.status === '없었음')
                      ? '없었다고 적은 기록'
                      : '이전 기간의 기록'}
                  </span>
                )}
                <p className="v2-source-text">
                  <HighlightedText
                    text={memo.text}
                    phrases={events.map((item) => item.event.evidence)}
                  />
                </p>
              </article>
            ))}
          </div>
          {selected.length > visible && (
            <button
              className="button outline v2-source-more"
              onClick={() => setVisible((value) => value + 10)}
            >
              나머지 {selected.length - visible}건 더 보기
            </button>
          )}
        </>
      ) : (
        <p>연결된 근거 원문이 없습니다.</p>
      )}
      <p className="v2-source-footnote">이 화면에서만 보여요. 인쇄본에는 포함하지 않습니다.</p>
    </>
  )
}
function SourcePanel({
  selection,
  open,
  onClose,
  memos,
  loading,
  error,
  retry,
}: {
  selection: SourceSelection | null
  open: boolean
  onClose: () => void
  memos: MemoResult[]
  loading: boolean
  error: string
  retry: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const startY = useRef<number | null>(null)
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 760px)')
    const sync = () => {
      if (open && media?.matches) {
        if (!dialog.current?.open) dialog.current?.showModal()
      } else dialog.current?.close()
    }
    sync()
    media?.addEventListener('change', sync)
    return () => {
      media?.removeEventListener('change', sync)
      dialog.current?.close()
    }
  }, [open])
  return (
    <>
      <aside className="v2-source-panel" aria-label="근거 원문">
        <header>
          <h2>근거 원문</h2>
          {selection && (
            <button className="icon-button" aria-label="근거 원문 닫기" onClick={onClose}>
              <X size={18} />
            </button>
          )}
        </header>
        <SourceContent
          selection={selection}
          memos={memos}
          loading={loading}
          error={error}
          retry={retry}
        />
      </aside>
      <dialog
        ref={dialog}
        className="v2-source-sheet"
        aria-label={selection?.title ?? '근거 원문'}
        onCancel={onClose}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
      >
        <div className="v2-source-sheet-body">
          <header
            onTouchStart={(event) => {
              startY.current = event.touches[0].clientY
            }}
            onTouchEnd={(event) => {
              if (startY.current !== null && event.changedTouches[0].clientY - startY.current > 65)
                onClose()
              startY.current = null
            }}
          >
            <span className="v2-sheet-handle" />
            <h2>근거 원문</h2>
            <button className="icon-button" aria-label="닫기" onClick={onClose}>
              <X size={20} />
            </button>
          </header>
          <SourceContent
            selection={selection}
            memos={memos}
            loading={loading}
            error={error}
            retry={retry}
          />
        </div>
      </dialog>
    </>
  )
}
function printReviewRequested() {
  const [page, query] = window.location.hash.slice(1).split('?')
  return page === 'summary' && new URLSearchParams(query).get('review') === 'print'
}
function consumePrintReviewRequest() {
  if (!printReviewRequested()) return
  const params = new URLSearchParams(window.location.hash.split('?')[1])
  params.delete('review')
  const oldURL = window.location.href
  window.history.replaceState(null, '', `#summary${params.size ? `?${params}` : ''}`)
  window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: window.location.href }))
}
export function SummaryPage({ active }: { health: Health; active: boolean }) {
  const selection = useReportSelection()
  const { asOf, periodStart } = selection
  const [periodPending, setPeriodPending] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(true)
  const { data, error, loading, reload } = useSummary(asOf, active, periodStart, aiEnabled)
  const visitPeriod = useVisitPeriod(active, data?.period.start)
  const source = useReportMemos(data, active && !loading && !error)
  const [legacyCharts, setLegacyCharts] = useState<{
    data: Summary
    charts: Trends[]
    failed: boolean
  } | null>(null)
  const [chartsRevision, setChartsRevision] = useState(0)
  const [reviewedData, setReviewedData] = useState<Summary | null>(null)
  const [printReviewOpen, setPrintReviewOpen] = useState(false)
  const resumePrintReview = printReviewRequested()
  const [assetsReady, setAssetsReady] = useState<Summary | null>(null)
  const [deferred, setDeferred] = useState<{ data: Summary; rows: string[] } | null>(null)
  const [evidence, setEvidence] = useState<SourceSelection | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [printError, setPrintError] = useState('')
  const [printRequested, setPrintRequested] = useState(false)
  const [copyMessage, setCopyMessage] = useState('')
  const [copying, setCopying] = useState(false)
  const copyRequest = useRef(0)
  const printCopy = useRef<HTMLDivElement>(null)
  const printLimit = useRef<HTMLDivElement>(null)
  const deferredRows = deferred?.data === data ? deferred.rows : []
  const charts = data?.trends ?? (legacyCharts?.data === data ? legacyCharts.charts : [])
  const chartsReady = Boolean(data && (data.trends !== undefined || legacyCharts?.data === data))
  const needsReview = Boolean(data && hasExclusions(data) && reviewedData !== data)
  const printReady = Boolean(
    active && data && !loading && !error && !periodPending && chartsReady && assetsReady === data,
  )
  const printEligible = printReady && !needsReview
  useEffect(() => {
    if (
      !active ||
      !data ||
      loading ||
      error ||
      data.trends !== undefined ||
      legacyCharts?.data === data
    )
      return
    let alive = true
    void Promise.allSettled(
      summaryTrendTypes(data).map((type) => api.trends(type, asOf, periodStart ?? undefined)),
    ).then((results) => {
      if (alive)
        setLegacyCharts({
          data,
          charts: results.flatMap((result) =>
            result.status === 'fulfilled' &&
            result.value.period.start === data.period.start &&
            result.value.period.end === data.period.end
              ? [result.value]
              : [],
          ),
          failed: results.some((result) => result.status === 'rejected'),
        })
    })
    return () => {
      alive = false
    }
  }, [active, data, loading, error, asOf, periodStart, chartsRevision])
  useEffect(() => {
    copyRequest.current += 1
    setCopying(false)
    setPrintError('')
    setPrintRequested(false)
    setPrintReviewOpen(false)
    setCopyMessage('')
    setSheetOpen(false)
    setEvidence(data?.sentences.length ? sourceForSentence(data, 0) : null)
  }, [data, loading])
  useEffect(() => {
    if (!active) {
      copyRequest.current += 1
      setCopying(false)
      setCopyMessage('')
      setSheetOpen(false)
      setPrintRequested(false)
      setPrintReviewOpen(false)
    }
  }, [active])
  useEffect(() => {
    // Wait through summary refreshes, errors and print preparation before consuming the return link.
    if (!active || !resumePrintReview || !printReady) return
    setPrintReviewOpen(true)
    consumePrintReviewRequest()
  }, [active, resumePrintReview, printReady])
  useEffect(() => {
    const afterPrint = () => {
      copyRequest.current += 1
      setCopying(false)
      setPrintRequested(false)
      setPrintError('')
      setCopyMessage('')
    }
    window.addEventListener('afterprint', afterPrint)
    return () => window.removeEventListener('afterprint', afterPrint)
  }, [])
  useLayoutEffect(() => {
    if (!active || !data || loading || error || !chartsReady || !printCopy.current) return
    let alive = true
    const prepare = () => {
      if (!alive) return
      const content = printCopy.current?.querySelector('.v2-page-core') as HTMLElement | null
      const limit = printLimit.current?.getBoundingClientRect().height ?? 0
      if (content && limit && content.scrollHeight > limit + 1) {
        const candidate = [...orderedRows(data)]
          .reverse()
          .find(
            (row) =>
              !deferredRows.includes(row.type) &&
              !isChange(row) &&
              !row.mark &&
              row.baseline_rate === 0 &&
              row.current_rate === 0,
          )
        if (candidate) {
          setDeferred({ data, rows: [...deferredRows, candidate.type] })
          return
        }
      }
      setAssetsReady(data)
    }
    let frame = 0
    void Promise.all([
      document.fonts?.ready,
      ...Array.from(printCopy.current.querySelectorAll('img')).map((image) =>
        image.decode?.().catch(() => undefined),
      ),
    ]).then(() => {
      if (alive) frame = requestAnimationFrame(prepare)
    })
    return () => {
      alive = false
      cancelAnimationFrame(frame)
    }
  }, [active, data, loading, error, chartsReady, deferredRows.length])
  function showEvidence(value: SourceSelection) {
    setEvidence(value)
    setSheetOpen(true)
  }
  function print(confirmedData?: Summary) {
    if (!printReady || (needsReview && confirmedData !== data)) return
    consumePrintReviewRequest()
    if (confirmedData) {
      // Commit eligibility and close the dialog before the browser reads print styles.
      // Keep window.print in this same click event so browsers retain user activation.
      flushSync(() => {
        setReviewedData(confirmedData)
        setPrintReviewOpen(false)
      })
    }
    setPrintError('')
    setCopyMessage('')
    setPrintRequested(true)
    try {
      window.print()
    } catch {
      setPrintError(
        '이 창에서 인쇄를 시작하지 못했어요. 아래 주소를 Chrome이나 Safari에서 열어 주세요.',
      )
    }
  }
  function requestPrint() {
    if (!printReady) return
    if (needsReview) setPrintReviewOpen(true)
    else print()
  }
  async function copyAddress() {
    if (copying) return
    const request = ++copyRequest.current
    setCopying(true)
    setCopyMessage('')
    try {
      await navigator.clipboard.writeText(window.location.href)
      if (request === copyRequest.current)
        setCopyMessage('주소를 복사했어요. Chrome이나 Safari의 주소창에 붙여 넣어 주세요.')
    } catch {
      if (request === copyRequest.current)
        setCopyMessage('주소를 자동으로 복사하지 못했어요. 아래 주소를 선택해 직접 복사해 주세요.')
    } finally {
      if (request === copyRequest.current) setCopying(false)
    }
  }
  function closePrintHelp() {
    copyRequest.current += 1
    setCopying(false)
    setPrintRequested(false)
    setCopyMessage('')
    setPrintError('')
  }
  function reloadCharts() {
    setLegacyCharts(null)
    setChartsRevision((value) => value + 1)
  }
  const printBlockReason = periodPending
    ? '선택한 기간을 확인하고 있습니다.'
    : loading
      ? '요약지를 만들고 있습니다. 완료된 뒤 인쇄해 주세요.'
      : needsReview
        ? '아직 반영되지 않은 기록을 확인한 뒤 출력해 주세요.'
        : error
          ? '요약지를 불러오지 못했습니다. 다시 불러온 뒤 인쇄해 주세요.'
          : '인쇄를 준비하고 있습니다.'
  return (
    <section
      className="mvp-report-page mvp-summary-page v2-summary-page"
      data-print-eligible={printEligible ? 'true' : 'false'}
    >
      <div className="mvp-summary-ui">
        <header className="mvp-page-heading">
          <div>
            <h1 tabIndex={-1}>경과 요약지</h1>
            <p className="v2-summary-intro">진료 때 함께 볼 관찰 기록입니다.</p>
          </div>
          <div className="mvp-summary-toolbar">
            <button
              className="button outline mvp-reload-summary"
              aria-label="새로 불러오기"
              onClick={reload}
              disabled={loading}
            >
              <RefreshCw size={18} />
            </button>
            <button
              className="button outline v2-template-button"
              onClick={() => setAiEnabled((value) => !value)}
            >
              {aiEnabled ? '문장 틀로 빠르게 보기' : 'AI 요약 보기'}
            </button>
          </div>
        </header>
        <section
          className="mvp-report-controls v2-summary-controls"
          aria-label="요약 기간과 PDF 저장"
        >
          <div className="v2-summary-control-row">
            <PeriodControls
              {...selection}
              active={active}
              defaultStart={visitPeriod.start}
              defaultEnd={visitPeriod.end}
              summary
              onPendingChange={setPeriodPending}
            />
            <button
              className="button v2-print-button"
              onClick={requestPrint}
              disabled={!printReady}
              aria-haspopup={needsReview ? 'dialog' : undefined}
            >
              <Printer size={18} />
              PDF로 저장
            </button>
          </div>
        </section>
        {loading ? (
          <p className="card v2-summary-loading" role="status">
            요약지를 불러오고 있어요…
          </p>
        ) : error ? (
          <div className="card mvp-error">
            <p>요약지를 불러오지 못했어요.</p>
            <button className="button outline" onClick={reload}>
              다시 불러오기
            </button>
          </div>
        ) : (
          data && (
            <>
              {!data.coverage.recorded_days && (
                <p className="mvp-notice">
                  확인 완료된 기록이 없습니다. 기록을 확인하면 요약지에 반영됩니다.
                </p>
              )}
              <div className="v2-summary-layout">
                <section className="v2-paper-preview" aria-label="A4 요약지 미리보기">
                  <SummarySheets
                    data={data}
                    charts={charts}
                    deferredRows={deferredRows}
                    onEvidence={showEvidence}
                  />
                </section>
                <MobileSummary data={data} charts={charts} onEvidence={showEvidence} />
                <SourcePanel
                  selection={evidence}
                  open={active && sheetOpen}
                  onClose={() => {
                    setEvidence(null)
                    setSheetOpen(false)
                  }}
                  memos={source.memos}
                  loading={source.loading}
                  error={source.error}
                  retry={source.reload}
                />
              </div>
              {legacyCharts?.data === data && legacyCharts.failed && (
                <p className="mvp-document-note">
                  일부 주간 추이를 불러오지 못했어요.{' '}
                  <button className="mvp-evidence-link" onClick={reloadCharts}>
                    다시 불러오기
                  </button>
                </p>
              )}
              <p className="mvp-document-note">A4 · 세로 · 배율 100% · 머리글/바닥글 끄기</p>
            </>
          )
        )}
        <ReportFeedback active={active} message={loading ? '' : error} onRetry={reload} />
        <Modal
          open={active && printReviewOpen && printReady && Boolean(data)}
          title="출력 전 기록 확인"
          onClose={() => {
            setPrintReviewOpen(false)
            consumePrintReviewRequest()
          }}
          footer={
            <div className="v2-print-review-actions">
              {data && hasExclusions(data) && (
                <a
                  className="button outline"
                  href={reportHref('record', {
                    view: 'history',
                    ...(data && { from: data.period.start, to: data.period.end }),
                  })}
                >
                  기록 확인하러 가기
                </a>
              )}
              <button className="button" onClick={() => data && print(data)}>
                {data && hasExclusions(data) ? '확인된 기록만 출력' : 'PDF로 저장'}
              </button>
            </div>
          }
        >
          {data && hasExclusions(data) ? (
            <>
              <p>
                아래 기록은 요약지에 반영되지 않았어요. 먼저 확인하거나, 제외한 상태로 출력할 수
                있어요.
              </p>
              <ExcludedRecords data={data} expanded returnTo="summary-print" />
            </>
          ) : (
            <p>확인할 기록이 없어요.</p>
          )}
        </Modal>
        <Modal
          open={active && printRequested}
          title={printError ? '인쇄를 시작하지 못했어요' : 'PDF 저장 안내'}
          tone={printError ? 'danger' : 'default'}
          onClose={closePrintHelp}
          footer={
            <button className="button" onClick={closePrintHelp}>
              확인
            </button>
          }
        >
          <div className="mvp-print-help">
            <p role={printError ? 'alert' : undefined}>
              {printError ||
                '인쇄 창에서 PDF로 저장을 선택해 주세요. 창이 열리지 않으면 Chrome이나 Safari에서 아래 주소를 열어 주세요.'}
            </p>
            <div>
              <label>
                현재 주소
                <input
                  readOnly
                  value={window.location.href}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
              <button
                className="button outline"
                disabled={copying}
                onClick={() => void copyAddress()}
              >
                {copying ? '복사 중…' : '주소 복사'}
              </button>
            </div>
            {copyMessage && <p role="status">{copyMessage}</p>}
          </div>
        </Modal>
      </div>
      <div className="mvp-print-blocked" aria-hidden="true">
        <h1>요약지를 인쇄할 수 없습니다</h1>
        <p>{printBlockReason}</p>
      </div>
      {data && !loading && !error && (
        <>
          <div className="mvp-print-limit" ref={printLimit} aria-hidden="true" />
          <div className="mvp-print-copy v2-print-copy" ref={printCopy} aria-hidden="true">
            <SummarySheets data={data} charts={charts} deferredRows={deferredRows} />
          </div>
        </>
      )}
    </section>
  )
}

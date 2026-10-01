import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { EVENT_TYPES } from '../../api/types'
import type { EventType, Health, SummaryRow } from '../../api/types'
import {
  EvidenceDialog,
  importantRows,
  isChange,
  markLabel,
  PeriodControls,
  ReportFeedback,
  rate,
  readableDate,
  TrendChart,
  weeklyCount,
  useSummary,
  useTrends,
} from '../../shared/report'
import type { EvidenceSelection } from '../../shared/report'
import { reportHref, useReportSelection } from '../../shared/lib/reportSelection'
import { medicationChangeLabel } from '../../shared/lib/medication'
import '../../shared/report/report.css'
import './progress.css'

function canCompare(row: SummaryRow) {
  return row.baseline_rate !== null && !['비교 불가', '기록 부족'].includes(row.mark ?? '')
}
function comparisonLabel(row: SummaryRow) {
  return canCompare(row)
    ? `기준 ${rate(row.baseline_rate)} → 이번 ${rate(row.current_rate)}`
    : `이번 ${rate(row.current_rate)}`
}
function Metric({ row, onSelect }: { row: SummaryRow; onSelect: () => void }) {
  const mark = markLabel(row.mark)
  return (
    <button
      type="button"
      className="card mvp-progress-stat"
      onClick={onSelect}
      aria-haspopup="dialog"
      aria-label={`${row.type}, ${comparisonLabel(row)}${mark ? `, ${mark}` : ''}. 관련 기록 보기`}
    >
      <span className="mvp-progress-stat-label">{row.type}</span>
      {mark && (
        <span
          className={`mvp-progress-mark ${mark === '증가' ? 'is-change' : mark === '새로 나타남' ? 'is-new' : ''}`}
        >
          {mark}
        </span>
      )}
      <strong>
        {canCompare(row) && (
          <>
            {rate(row.baseline_rate)}
            <span>→</span>
          </>
        )}
        {rate(row.current_rate)}
      </strong>
      <span className="mvp-progress-stat-caption">
        기록일 {row.recorded_days}일 중 {row.occurrence_days}일
        {row.weekly_count !== null && <> · 주당 {weeklyCount(row.weekly_count)}</>}
      </span>
    </button>
  )
}
export function ProgressPage({ active }: { health: Health; active: boolean }) {
  const selection = useReportSelection()
  const { requestAsOf: asOf, periodStart } = selection
  const [periodPending, setPeriodPending] = useState(false)
  const { data, error, loading, reload } = useSummary(asOf, active, periodStart, false)
  const [selectedType, setSelectedType] = useState<EventType | null>(null)
  const type =
    selectedType ?? data?.trends?.[0]?.type ?? data?.rows.find(isChange)?.type ?? '배회·출입문 시도'
  const chart = useTrends(type, asOf, active && !loading && !error, periodStart)
  const [evidence, setEvidence] = useState<EvidenceSelection | null>(null)
  useEffect(() => {
    setEvidence(null)
    setSelectedType(null)
  }, [asOf, periodStart, active])
  const primary = data
    ? importantRows(data.rows).filter((row) => row.type !== '낙상' && isChange(row))
    : []
  const medications = [...(data?.medications ?? [])].sort((a, b) => a.date.localeCompare(b.date))
  const falls = [...(data?.falls ?? [])].sort((a, b) => a.localeCompare(b))
  const visibleChart =
    chart.data?.type === type &&
    chart.data.period.start === data?.period.start &&
    chart.data.period.end === data?.period.end
      ? chart.data
      : null
  const selectedRow = data?.rows.find((row) => row.type === type)
  function openEvidence(row: SummaryRow) {
    if (!data) return
    setSelectedType(row.type)
    setEvidence({
      title: `${row.type} 관련 기록`,
      type: row.type,
      period: data.period,
      ids: row.memo_ids,
      dates: row.evidence_dates,
    })
  }
  const noComparison =
    data &&
    (!data.coverage.recorded_days
      ? '확인한 기록이 아직 없어요.'
      : !data.baseline
        ? '비교할 이전 진료 구간이 없어요.'
        : data.coverage.recorded_days < 14
          ? '이번 구간 기록이 14일보다 적어 비교하지 않았어요.'
          : '')
  return (
    <section className="mvp-report-page mvp-progress-simple">
      <header className="mvp-page-heading v2-progress-heading">
        <div>
          <h1 tabIndex={-1}>경과</h1>
        </div>
        <div className="v2-progress-actions">
          {data && !loading && !error && !periodPending && (
            <span className="v2-coverage-pill" aria-label="기록 커버리지">
              <span>기록 커버리지</span>
              <strong>
                {data.coverage.total_days}일 중 {data.coverage.recorded_days}일 기록
              </strong>
            </span>
          )}
        </div>
      </header>
      <div className="mvp-report-controls v2-progress-meta">
        <PeriodControls
          {...selection}
          active={active}
          defaultStart={data?.period.start}
          defaultEnd={data?.period.end}
          onPendingChange={setPeriodPending}
        />
      </div>
      {loading ? (
        <p className="card" role="status">
          기록을 불러오고 있어요…
        </p>
      ) : error ? (
        <div className="card mvp-error">
          <p>경과를 불러오지 못했어요.</p>
          <button className="button outline" onClick={reload}>
            다시 불러오기
          </button>
        </div>
      ) : (
        data && (
          <>
            {noComparison && (
              <p className="v2-comparison-note">
                <span className="mvp-progress-mark">
                  {data.baseline ? '기록 부족' : '비교 불가'}
                </span>
                {noComparison}
                {!data.coverage.recorded_days && <a href={reportHref('record')}>기록하러 가기</a>}
              </p>
            )}
            <section className="mvp-progress-featured" aria-label="주요 관찰 기록">
              <div className="mvp-progress-cards" data-count={Math.min(4, primary.length + 1)}>
                {primary.map((row) => (
                  <Metric key={row.type} row={row} onSelect={() => openEvidence(row)} />
                ))}
                <button
                  type="button"
                  className="card mvp-progress-stat v2-fall-stat"
                  onClick={() => {
                    const row = data.rows.find((row) => row.type === '낙상')
                    if (row) openEvidence(row)
                  }}
                  disabled={!data.falls.length}
                  aria-label="낙상 관련 기록 보기"
                >
                  <span className="mvp-progress-stat-label">낙상</span>
                  <span className="mvp-progress-mark is-new">항상 표시</span>
                  <strong>{falls.length ? readableDate(falls.at(-1)!) : '기록 없음'}</strong>
                  <span className="mvp-progress-stat-caption">
                    {data.falls.length
                      ? `이번 구간 ${data.falls.length}일 기록`
                      : '이번 구간에 확인된 낙상 없음'}
                  </span>
                </button>
              </div>
            </section>
            {!primary.length && !noComparison && (
              <p className="v2-comparison-note">
                {data.coverage.recorded_days
                  ? '증가·새로 나타남 표시가 붙은 항목이 없어요.'
                  : '확인한 기록이 아직 없어요.'}
                {!data.coverage.recorded_days && <a href={reportHref('record')}>기록하러 가기</a>}
              </p>
            )}
            <div className="mvp-progress-columns">
              <section className="card mvp-progress-chart" aria-labelledby="progress-chart-heading">
                <div className="mvp-progress-chart-heading">
                  <h2 id="progress-chart-heading">주간 추이</h2>
                  <label>
                    <span>유형</span>
                    <select
                      aria-label="추이 유형"
                      value={type}
                      onChange={(event) => setSelectedType(event.target.value as EventType)}
                    >
                      {EVENT_TYPES.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {chart.error ? (
                  <div className="mvp-progress-chart-state" role="alert">
                    <p>{chart.error}</p>
                    <button className="button outline" onClick={chart.reload}>
                      다시 불러오기
                    </button>
                  </div>
                ) : visibleChart ? (
                  <TrendChart data={visibleChart} simple />
                ) : (
                  <p className="mvp-progress-chart-state" role="status">
                    흐름을 불러오고 있어요…
                  </p>
                )}
                <div className="v2-chart-legend">
                  <span>
                    <i className="navy" />
                    주별 발생일 비율
                  </span>
                  <span>
                    <i className="gray" />
                    기록 4일 미만인 주 · 비율 표시 안 함
                  </span>
                  <span>
                    <i className="dashed" />
                    진료일·약 변경
                  </span>
                  <span>
                    <i className="mint" />
                    이번 구간
                  </span>
                </div>
                <p className="v2-timeline-note">
                  세로선은 날짜 순서를 보여 줄 뿐, 변화의 원인을 뜻하지 않아요.
                </p>
                <button
                  type="button"
                  className="button outline v2-chart-evidence"
                  aria-haspopup="dialog"
                  disabled={!selectedRow}
                  onClick={() => selectedRow && openEvidence(selectedRow)}
                >
                  <Search size={16} aria-hidden="true" />
                  관련 기록 보기
                </button>
              </section>
              <div className="mvp-progress-histories">
                <section
                  className="card mvp-progress-timeline"
                  aria-labelledby="progress-medications-heading"
                >
                  <h2 id="progress-medications-heading">약 변경</h2>
                  {medications.length ? (
                    <ol>
                      {medications.map((item, index) => (
                        <li key={`${item.date}-${index}`}>
                          <time dateTime={item.date}>{readableDate(item.date)}</time>
                          <span>
                            {item.name} · {medicationChangeLabel(item.change_type)}
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p>등록한 약 변경이 없어요.</p>
                  )}
                </section>
                <section
                  className="card mvp-progress-timeline"
                  aria-labelledby="progress-falls-heading"
                >
                  <h2 id="progress-falls-heading">낙상</h2>
                  {falls.length ? (
                    <ol>
                      {falls.map((date) => (
                        <li key={date}>
                          <time dateTime={date}>{readableDate(date)}</time>
                          <span className="is-fall">낙상</span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p>이번 구간에 확인된 낙상 없음</p>
                  )}
                </section>
              </div>
            </div>
            <p className="v2-progress-footnote">
              표시는 기록에서 계산한 사실이며 진단이 아니에요. 표시가 없다고 이상이 없다는 뜻은
              아니에요. 기록한 날 언급이 없는 증상은 없었던 것으로 계산해요.
            </p>
          </>
        )
      )}
      <ReportFeedback active={active} message={loading ? '' : error} onRetry={reload} />
      {active && evidence && (
        <EvidenceDialog selection={evidence} onClose={() => setEvidence(null)} />
      )}
    </section>
  )
}

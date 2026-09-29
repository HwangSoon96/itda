import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
} from 'recharts'
import type { Trends } from '../../api/types'
import { medicationChangeLabel } from '../lib/medication'
import { rate, shortDate } from './format'

export function TrendChart({
  data,
  compact = false,
  simple = false,
}: {
  data: Trends
  compact?: boolean
  simple?: boolean
}) {
  const points = data.weeks.map((week) => ({
    ...week,
    timestamp: Date.parse(`${week.start}T00:00:00Z`),
    lineRate: week.low_coverage ? null : week.rate,
    lowRate: week.low_coverage ? 0 : null,
  }))
  const first = points[0]?.timestamp ?? Date.parse(data.period.start)
  const last = Date.parse(`${data.period.end}T00:00:00Z`)
  const markers =
    data.markers ??
    data.medications.map((item) => ({
      kind: 'medication' as const,
      date: item.date,
      label: `${item.name} · ${medicationChangeLabel(item.change_type)}`,
    }))
  const markerDates = [...new Set(markers.map((item) => item.date))].sort()
  const markerRows = Math.min(3, markerDates.length)
  return (
    <div className={`mvp-trend ${compact ? 'is-compact' : ''}`}>
      {!simple && (
        <p className="mvp-chart-title">
          {data.type} <span>발생일 비율</span>
        </p>
      )}
      <div
        className="mvp-chart"
        role="img"
        aria-label={`${data.type} 주간 추이. 기록일이 4일 미만인 주는 비율을 표시하지 않고 아래쪽 회색 점으로 표시하며 선을 연결하지 않습니다.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={points}
            margin={{ top: 22 + Math.max(0, markerRows - 1) * 14, right: 28, bottom: 2, left: -12 }}
          >
            <CartesianGrid vertical={false} stroke="#dce3e6" />
            <XAxis
              dataKey="timestamp"
              type="number"
              domain={[first, Math.max(first + 86400000, last)]}
              tickFormatter={(value) => shortDate(new Date(value).toISOString().slice(0, 10))}
              tick={{ fontSize: compact ? 10 : 12 }}
              minTickGap={24}
            />
            <YAxis
              domain={[0, 1]}
              ticks={[0, 0.5, 1]}
              tickFormatter={(value) => `${value * 100}%`}
              tick={{ fontSize: compact ? 10 : 12 }}
            />
            {!compact && (
              <Tooltip
                labelFormatter={(value) => new Date(Number(value)).toISOString().slice(0, 10)}
                formatter={(value, name) =>
                  name === '기록 적음'
                    ? ['기록 4일 미만 · 비율 표시 안 함', '기록 부족']
                    : [rate(typeof value === 'number' ? value : null), '발생일 비율']
                }
              />
            )}
            <ReferenceArea
              x1={Date.parse(`${data.period.start}T00:00:00Z`)}
              x2={last}
              fill="#79bca8"
              fillOpacity={0.14}
              strokeOpacity={0}
            />
            {markerDates.map((date, index) => (
              <ReferenceLine
                key={date}
                x={Date.parse(`${date}T00:00:00Z`)}
                stroke="#7f93ab"
                strokeDasharray="4 4"
                label={{
                  className: 'mvp-chart-marker-label',
                  value: `${shortDate(date)} ${[markers.some((item) => item.date === date && item.kind === 'visit') ? '진료' : '', markers.some((item) => item.date === date && item.kind === 'medication') ? '약' : ''].filter(Boolean).join('·')}`,
                  position: 'top',
                  dy: index % 3 ? -(index % 3) * 14 : 0,
                  fontSize: compact ? 9 : 10,
                }}
              />
            ))}
            <Line
              type="linear"
              dataKey="lineRate"
              name="발생일 비율"
              stroke="#1b426d"
              strokeWidth={2}
              dot={{ r: compact ? 2 : 3 }}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="lowRate"
              name="기록 적음"
              stroke="none"
              dot={{ r: 4, fill: '#89949c', stroke: '#89949c' }}
              activeDot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {!compact && !simple && (
        <>
          <p className="mvp-caption">
            아래쪽 회색 점은 기록 4일 미만인 주이며 0%라는 뜻이 아닙니다. 점선은 진료일·약 변경일로,
            변화의 원인을 뜻하지 않습니다.
          </p>
          {data.medications.length > 0 && (
            <ul className="mvp-chart-meds">
              {data.medications.map((medication, index) => (
                <li key={index}>
                  {medication.date} · {medication.name}{' '}
                  {medicationChangeLabel(medication.change_type)}
                </li>
              ))}
            </ul>
          )}
          <details className="mvp-data-table">
            <summary>주별 수치 확인</summary>
            <div className="mvp-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>구간</th>
                    <th>주간</th>
                    <th>발생일 / 기록일</th>
                    <th>비율</th>
                    <th>기록 상태</th>
                  </tr>
                </thead>
                <tbody>
                  {data.weeks.map((week) => (
                    <tr key={`${week.period}-${week.start}`}>
                      <td>{week.period === 'baseline' ? '기준' : '이번'}</td>
                      <td>
                        {shortDate(week.start)} ~ {shortDate(week.end)}
                      </td>
                      <td>
                        {week.event_days} / {week.recorded_days}일
                      </td>
                      <td>{rate(week.rate)}</td>
                      <td>{week.low_coverage ? '기록 적음' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  )
}

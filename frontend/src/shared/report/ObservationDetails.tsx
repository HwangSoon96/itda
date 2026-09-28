import type { Summary } from '../../api/types'
import { baselineOccurrence, rate, readablePeriod, weeklyCount } from './format'

export function ObservationDetails({ data }: { data: Summary }) {
  return (
    <details className="mvp-data-table card">
      <summary>비율과 계산 자세히 보기</summary>
      <p className="mvp-caption">
        이전: {data.baseline ? readablePeriod(data.baseline) : '비교할 이전 기록 없음'} · 이번:{' '}
        {readablePeriod(data.period)}
      </p>
      <p className="mvp-caption">
        비율은 확인한 기록일 중 해당 일이 있었던 날의 비율입니다. 메모에서 선택한 날짜를 기준으로,
        같은 날짜는 한 번만 셉니다.
      </p>
      <div className="mvp-table-scroll">
        <table>
          <thead>
            <tr>
              <th>관찰 항목</th>
              <th>이전 비율</th>
              <th>이번 비율</th>
              <th>이번 7일 환산</th>
              <th>이번 있었음</th>
              <th>이번 없었음</th>
              <th>이번 언급 없음</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.type}>
                <th>{row.type}</th>
                <td>
                  {rate(row.baseline_rate)}
                  <small>{baselineOccurrence(row, data)}</small>
                </td>
                <td>
                  {rate(row.current_rate)}
                  <small>
                    {row.occurrence_days}/{row.recorded_days}일
                  </small>
                </td>
                <td>{weeklyCount(row.weekly_count)}</td>
                <td>{row.occurrence_days}일</td>
                <td>{row.absent_days === undefined ? '—' : `${row.absent_days}일`}</td>
                <td>{row.unmentioned_days === undefined ? '—' : `${row.unmentioned_days}일`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mvp-caption">
        ‘없었음’은 없었다고 직접 적은 날이고, ‘언급 없음’은 그 항목에 관한 내용이 없는 날입니다.
        같은 날 둘 다 적었으면 ‘있었음’으로 셉니다. 0%는 증상이 없었다는 판단이 아닙니다. 7일 환산은
        기록한 횟수의 합 ÷ 기록이 있는 날 × 7이며 실제 한 주의 횟수와 다를 수 있습니다. ‘새로
        나타남’은 이전 기간에 없던 발생 기록으로, 증상의 실제 시작일을 뜻하지 않습니다.
      </p>
      <details>
        <summary>이전 기간의 관찰 상태</summary>
        <div className="mvp-table-scroll">
          <table>
            <thead>
              <tr>
                <th>관찰 항목</th>
                <th>있었음</th>
                <th>없었음</th>
                <th>언급 없음</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.type}>
                  <th>{row.type}</th>
                  <td>{row.baseline_occurrence_days ?? '—'}일</td>
                  <td>{row.baseline_absent_days ?? '—'}일</td>
                  <td>{row.baseline_unmentioned_days ?? '—'}일</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </details>
  )
}

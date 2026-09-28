import type { Summary } from '../../api/types'

export function summaryTrendTypes(data: Summary) {
  return data.rows
    .filter(
      (row) =>
        row.occurrence_days >= 3 ||
        (row.baseline_occurrence_days ??
          Math.round(
            (row.baseline_rate ?? 0) *
              (row.baseline_recorded_days ?? data.baseline_coverage?.recorded_days ?? 0),
          )) >= 3,
    )
    .sort((a, b) =>
      data.baseline
        ? Math.abs((b.current_rate ?? 0) - (b.baseline_rate ?? 0)) -
          Math.abs((a.current_rate ?? 0) - (a.baseline_rate ?? 0))
        : (b.current_rate ?? 0) - (a.current_rate ?? 0),
    )
    .slice(0, 3)
    .map((row) => row.type)
}

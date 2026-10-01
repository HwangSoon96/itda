import { describe, expect, it } from 'vitest'
import { evidenceDatesLabel, summaryEvidenceDatesLabel } from '../src/shared/lib/evidenceDates'

describe('printed source dates remain traceable', () => {
  it('keeps every separated date, including dates in the middle of a long list', () => {
    expect(
      evidenceDatesLabel([
        '2026-09-01',
        '2026-09-03',
        '2026-09-06',
        '2026-09-10',
        '2026-09-15',
        '2026-09-22',
      ]),
    ).toBe('09/01, 09/03, 09/06, 09/10, 09/15, 09/22')
  })
  it('compresses only uninterrupted runs and preserves missing-day gaps', () => {
    expect(
      evidenceDatesLabel([
        '2026-09-08',
        '2026-09-01',
        '2026-09-02',
        '2026-09-03',
        '2026-09-06',
        '2026-09-07',
        '2026-09-08',
      ]),
    ).toBe('09/01~09/03, 09/06~09/08')
  })
  it('identifies years across a year boundary', () => {
    expect(evidenceDatesLabel(['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-03'])).toBe(
      '2025/12/30~2026/01/01, 2026/01/03',
    )
  })
  it('handles no source and a single source', () => {
    expect(evidenceDatesLabel([])).toBe('—')
    expect(evidenceDatesLabel(['2026-09-27'])).toBe('09/27')
  })
})

describe('summary source-date labels follow the first-three rule', () => {
  it('sorts and removes duplicates before showing the first three dates and remaining day count', () => {
    const dates = [
      '2026-06-13',
      '2026-05-23',
      '2026-06-06',
      '2026-05-22',
      '2026-06-08',
      '2026-05-23',
    ]
    const original = [...dates]
    expect(summaryEvidenceDatesLabel(dates)).toBe('05/22, 05/23, 06/06 외 2일')
    expect(dates).toEqual(original)
  })
  it('shows every date when there are at most three, including consecutive days', () => {
    expect(summaryEvidenceDatesLabel(['2026-09-01', '2026-09-02', '2026-09-03'])).toBe(
      '09/01, 09/02, 09/03',
    )
    expect(summaryEvidenceDatesLabel(['2026-09-27', '2026-09-27'])).toBe('09/27')
    expect(summaryEvidenceDatesLabel(['2026-09-27', '2026-09-26'])).toBe('09/26, 09/27')
  })
  it('counts all unique remaining days, including long lists', () => {
    const dates = Array.from(
      { length: 22 },
      (_, index) => `2026-09-${String(index + 1).padStart(2, '0')}`,
    )
    expect(summaryEvidenceDatesLabel(dates)).toBe('09/01, 09/02, 09/03 외 19일')
  })
  it('includes years when a different year exists only among hidden dates', () => {
    expect(
      summaryEvidenceDatesLabel(['2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01']),
    ).toBe('2025/12/29, 2025/12/30, 2025/12/31 외 1일')
    expect(summaryEvidenceDatesLabel(['2026-01-03', '2025-12-31', '2026-01-01'])).toBe(
      '2025/12/31, 2026/01/01, 2026/01/03',
    )
  })
  it('keeps the existing empty marker', () => {
    expect(summaryEvidenceDatesLabel([])).toBe('—')
  })
})

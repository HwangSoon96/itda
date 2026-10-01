import type { Summary } from '../../api/types'
import { reportHref } from '../lib/reportSelection'
import { exclusionLabel, exclusionsOf, hasExclusions } from './format'

export function ExcludedRecords({
  data,
  expanded = false,
  returnTo,
}: {
  data: Summary
  expanded?: boolean
  returnTo?: 'summary-print'
}) {
  if (!hasExclusions(data)) return null
  const value = exclusionsOf(data)
  const groups = [
    { title: '확인 대기 메모', ids: value.pending_memo_ids },
    { title: '정리 실패 메모', ids: value.failed_memo_ids },
  ]
  const count = new Set(groups.flatMap((group) => group.ids)).size
  const records = (
    <>
      <p>{exclusionLabel(data)}</p>
      {groups
        .filter((group) => group.ids.length)
        .map((group) => (
          <div key={group.title}>
            <h3>{group.title}</h3>
            <ul>
              {group.ids.map((id) => (
                <li key={id}>
                  <a
                    href={reportHref('record', {
                      memo: String(id),
                      ...(returnTo && { return_to: returnTo }),
                    })}
                  >
                    {group.title} {id}번 열기
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </>
  )
  return (
    <section className="mvp-excluded-records" aria-label="요약에 반영되지 않은 기록">
      {expanded ? (
        records
      ) : (
        <details>
          <summary>
            <span>아직 확인할 기록 {count}건 · 요약에서 제외됨</span>
            <span className="mvp-excluded-action">기록 확인</span>
          </summary>
          {records}
        </details>
      )}
    </section>
  )
}

import { useEffect, useRef, useState } from 'react'
import { api } from '../../api'
import type { MemoResult } from '../../api/types'
import { currentOccurrence, matchingEvidence } from './evidence'
import type { EvidenceSelection, ObservationEvidence } from './evidence'
import { errorText, readableDate } from './format'

export function EvidenceDialog({
  selection,
  onClose,
}: {
  selection: EvidenceSelection
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [revision, setRevision] = useState(0)
  const [memos, setMemos] = useState<MemoResult[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  useEffect(() => {
    let alive = true
    setMemos(null)
    setError('')
    api
      .memos({})
      .then((values) => {
        if (alive) setMemos(values)
      })
      .catch((failure) => {
        if (alive) setError(errorText(failure))
      })
    return () => {
      alive = false
    }
  }, [selection, revision])
  const relevant = memos ? matchingEvidence(memos, selection) : []
  const occurrences = relevant.filter((item) => currentOccurrence(item, selection.period))
  const other = relevant.filter((item) => !occurrences.includes(item))
  const notesOnly =
    memos?.filter(
      (memo) =>
        memo.status === '확인 완료' &&
        (selection.ids.length
          ? selection.ids.includes(memo.memo_id)
          : selection.dates.includes(memo.record_date)) &&
        !relevant.some((item) => item.memo.memo_id === memo.memo_id),
    ) ?? []
  const coverageMemos =
    selection.kind === 'coverage'
      ? (memos ?? [])
          .filter(
            (memo) =>
              memo.status === '확인 완료' &&
              (selection.ids.length
                ? selection.ids.includes(memo.memo_id)
                : selection.dates.includes(memo.record_date)) &&
              (!selection.period ||
                (memo.record_date >= selection.period.start &&
                  memo.record_date <= selection.period.end)),
          )
          .sort((a, b) => b.record_date.localeCompare(a.record_date) || b.memo_id - a.memo_id)
      : []
  function observation(item: ObservationEvidence, index: number) {
    const { memo, event } = item
    return (
      <article key={`${memo.memo_id}-${index}`} className="mvp-evidence-memo">
        <h3>
          {readableDate(memo.record_date, true)} · {event.type}
        </h3>
        <p className="mvp-evidence-state">
          {event.status === '있었음' ? `있었다고 기록 · ${event.count}회` : '없었다고 적은 기록'}
        </p>
        <blockquote>{event.evidence}</blockquote>
        <details>
          <summary>전체 메모 보기</summary>
          <p className="mvp-raw-text">{memo.text}</p>
        </details>
      </article>
    )
  }
  return (
    <dialog
      ref={dialog}
      className="mvp-evidence-dialog"
      aria-labelledby="evidence-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <header>
        <div>
          <p className="mvp-eyebrow">보호자가 확인한 관찰</p>
          <h2 id="evidence-title">{selection.title}</h2>
        </div>
        <button className="button outline" onClick={onClose} autoFocus>
          닫기
        </button>
      </header>
      <p className="mvp-caption">
        {selection.kind === 'coverage'
          ? '기록일 수에 포함된 확인 완료 메모입니다.'
          : '선택한 날짜의 확인된 기록입니다.'}
      </p>
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <button className="button outline" onClick={() => setRevision((value) => value + 1)}>
            다시 불러오기
          </button>
        </div>
      ) : !memos ? (
        <p role="status">원문을 불러오고 있어요…</p>
      ) : selection.kind === 'coverage' ? (
        <>
          {coverageMemos.map((memo) => (
            <article className="mvp-evidence-memo" key={memo.memo_id}>
              <h3>{readableDate(memo.record_date, true)}</h3>
              <p className="mvp-raw-text">{memo.text}</p>
            </article>
          ))}
          {!coverageMemos.length && <p>연결된 확인 완료 원문이 없어요.</p>}
        </>
      ) : (
        <>
          {occurrences.length > 0 ? (
            occurrences.map(observation)
          ) : (
            <p className="mvp-caption">이 기간에 ‘있었음’으로 확인한 관련 사건은 없어요.</p>
          )}
          {other.length > 0 && (
            <details className="mvp-other-evidence">
              <summary>이전 기록·없었다고 적은 내용 ({other.length}건)</summary>
              {other.map(observation)}
            </details>
          )}
          {notesOnly.length > 0 && (
            <details>
              <summary>함께 계산한 일상 메모 ({notesOnly.length}건)</summary>
              {notesOnly.map((memo) => (
                <article className="mvp-evidence-memo" key={memo.memo_id}>
                  <h3>{readableDate(memo.record_date, true)}</h3>
                  <p className="mvp-raw-text">{memo.text}</p>
                </article>
              ))}
            </details>
          )}
          {!relevant.length && !notesOnly.length && <p>연결된 확인 완료 원문이 없어요.</p>}
        </>
      )}
    </dialog>
  )
}

import { useId, useMemo } from 'react'
import type { KeyboardEvent, SyntheticEvent } from 'react'
import './evidence-selector.css'

function adjacentBoundary(boundaries: number[], offset: number, direction: -1 | 1) {
  let low = 0
  let high = boundaries.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (boundaries[middle] < offset || (direction === 1 && boundaries[middle] === offset))
      low = middle + 1
    else high = middle
  }
  return boundaries[direction === 1 ? Math.min(low, boundaries.length - 1) : Math.max(0, low - 1)]
}

export function EvidenceSelector({
  text,
  value,
  onChange,
  disabled = false,
}: {
  text: string
  value: string
  onChange: (evidence: string) => void
  disabled?: boolean
}) {
  const id = useId()
  const boundaries = useMemo(
    () => [
      0,
      ...Array.from(
        new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(text),
        ({ index, segment }) => index + segment.length,
      ),
    ],
    [text],
  )
  const selectedEvidence = value.trim() && text.includes(value) ? value : ''
  const selectEvidence = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    if (disabled) return
    const { selectionStart, selectionEnd } = event.currentTarget
    if (selectionEnd <= selectionStart) return
    const evidence = text.slice(selectionStart, selectionEnd)
    if (evidence.trim() && evidence !== value) onChange(evidence)
  }
  const moveSelection = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      disabled ||
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
    )
      return

    const source = event.currentTarget
    const { selectionStart: start, selectionEnd: end, selectionDirection } = source
    const backward = selectionDirection === 'backward'
    const anchor = backward ? end : start
    const focus = backward ? start : end
    let next: number
    if (event.key === 'Home') next = focus === 0 ? 0 : text.lastIndexOf('\n', focus - 1) + 1
    else if (event.key === 'End') {
      const lineEnd = text.indexOf('\n', focus)
      next = lineEnd < 0 ? text.length : lineEnd
    } else if (!event.shiftKey && start !== end) next = event.key === 'ArrowLeft' ? start : end
    else next = adjacentBoundary(boundaries, focus, event.key === 'ArrowLeft' ? -1 : 1)

    // Read-only textareas do not consistently move their caret with these keys.
    event.preventDefault()
    if (event.shiftKey)
      source.setSelectionRange(
        Math.min(anchor, next),
        Math.max(anchor, next),
        next < anchor ? 'backward' : next > anchor ? 'forward' : 'none',
      )
    else source.setSelectionRange(next, next, 'none')
    selectEvidence(event)
  }

  return (
    <div className="mvp-rc-evidence-selector">
      <label htmlFor={`${id}-source`}>원문에서 근거 선택</label>
      <p id={`${id}-hint`} className="mvp-rc-evidence-selection-hint">
        근거가 되는 구절을 선택해 주세요. 휴대폰에서는 길게 눌러 선택해요.
      </p>
      <textarea
        id={`${id}-source`}
        className="mvp-rc-evidence-source"
        aria-describedby={`${id}-hint`}
        value={text}
        readOnly
        disabled={disabled}
        rows={3}
        onKeyDown={moveSelection}
        onSelect={selectEvidence}
        // Some native mobile selection controls finish when focus moves away.
        onBlur={selectEvidence}
      />
      <div className="mvp-rc-evidence-selection" role="region" aria-labelledby={`${id}-selection`}>
        <span id={`${id}-selection`}>선택한 근거</span>
        <p className={selectedEvidence ? undefined : 'is-empty'}>
          {selectedEvidence || '아직 선택한 구절이 없어요.'}
        </p>
      </div>
    </div>
  )
}

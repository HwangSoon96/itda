import { useEffect, useState } from 'react'

const MESSAGES = [
  '요약지를 만들고 있어요!',
  '기록을 꼼꼼히 살펴보는 중이에요',
  '변화가 있었는지 확인하고 있어요',
  '거의 다 됐어요, 조금만 기다려주세요~',
]
const MESSAGE_INTERVAL_MS = 3500

/** Shown while the summary is being generated: the mascot bounces and the message rotates so the wait feels alive. */
export function SummaryLoader() {
  const [index, setIndex] = useState(0)
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    const id = window.setInterval(
      () => setIndex((current) => Math.min(current + 1, MESSAGES.length - 1)),
      MESSAGE_INTERVAL_MS,
    )
    return () => window.clearInterval(id)
  }, [])
  return (
    <div className="card v2-summary-loading">
      {!missing && (
        <img
          className="v2-summary-loading-mascot"
          src="/assets/mascot.svg"
          alt=""
          aria-hidden="true"
          onError={() => setMissing(true)}
        />
      )}
      <p className="v2-summary-loading-text" role="status" aria-live="polite">
        {MESSAGES[index]}
        <span className="v2-summary-loading-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </p>
    </div>
  )
}

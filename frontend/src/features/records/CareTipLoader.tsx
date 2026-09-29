import { useEffect, useState } from 'react'
import { Lightbulb } from 'lucide-react'
import careTips from './careTips.json'

type CareTip = (typeof careTips.tips)[number]
type TipCategory = keyof typeof careTips.categories

const TIP_INTERVAL_MS = 7000

// Pick a random tip, avoiding the one already on screen so the bubble always changes.
function randomTip(current?: CareTip): CareTip {
  const pool = current ? careTips.tips.filter((tip) => tip.id !== current.id) : careTips.tips
  return pool[Math.floor(Math.random() * pool.length)]
}

/** Mascot image; hides itself if the asset fails to load. */
export function Mascot({ className = '' }: { className?: string }) {
  const [missing, setMissing] = useState(false)
  if (missing) return null
  return (
    <img
      className={`mvp-rc-mascot ${className}`}
      src="/assets/mascot.svg"
      alt=""
      aria-hidden="true"
      onError={() => setMissing(true)}
    />
  )
}

/** Shown while the model organizes a memo: the mascot says what is happening, and one random care tip rotates below. */
export function CareTipLoader() {
  const [tip, setTip] = useState(() => randomTip())
  useEffect(() => {
    const id = window.setInterval(() => setTip((current) => randomTip(current)), TIP_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [])
  return (
    <div className="mvp-rc-tip-loader">
      <div className="mvp-rc-tip-greeting">
        <Mascot className="is-writing" />
        {/* Only the progress text is live; rotating tips would interrupt screen readers. */}
        <p className="mvp-rc-speech-bubble" role="status" aria-live="polite">
          작성하신 메모를 정리하고 있어요! 조금만 기다려주세요~
        </p>
      </div>
      <figure className="mvp-rc-tip-bubble" key={tip.id}>
        <figcaption>
          <Lightbulb size={16} aria-hidden="true" />
          {careTips.categories[tip.category as TipCategory]} 팁
        </figcaption>
        <p>{tip.text}</p>
      </figure>
    </div>
  )
}

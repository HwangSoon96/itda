import { useEffect, useState } from 'react'
import { FeedbackDialog } from '../ui'

export function ReportFeedback({
  message,
  active = true,
  title = '불러오지 못했어요',
  tone = 'error',
  onRetry,
}: {
  message: string
  active?: boolean
  title?: string
  tone?: 'error' | 'info'
  onRetry?: () => void
}) {
  const [dismissed, setDismissed] = useState('')
  useEffect(() => {
    if (!message) setDismissed('')
  }, [message])
  return active && message && dismissed !== message ? (
    <FeedbackDialog
      title={title}
      message={message}
      tone={tone}
      onClose={() => setDismissed(message)}
      action={onRetry ? { label: '다시 불러오기', onClick: onRetry } : undefined}
    />
  ) : null
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'

type Confirmation = {
  title: string
  message: string
  confirmLabel?: string
  tone?: 'default' | 'danger'
}
export function useConfirmation(active = true) {
  const [request, setRequest] = useState<Confirmation | null>(null)
  const resolve = useRef<((value: boolean) => void) | null>(null)
  const finish = useCallback((value: boolean) => {
    const done = resolve.current
    resolve.current = null
    setRequest(null)
    done?.(value)
  }, [])
  const ask = useCallback(
    (options: Confirmation) => {
      if (resolve.current || !active) return Promise.resolve(false)
      return new Promise<boolean>((done) => {
        resolve.current = done
        setRequest(options)
      })
    },
    [active],
  )
  useEffect(() => {
    if (!active) finish(false)
  }, [active, finish])
  useEffect(
    () => () => {
      resolve.current?.(false)
      resolve.current = null
    },
    [],
  )
  const dialog = (
    <Modal
      open={active && Boolean(request)}
      title={request?.title ?? ''}
      onClose={() => finish(false)}
      tone={request?.tone ?? 'default'}
      role="alertdialog"
      variant="message"
      footer={
        <>
          <button
            type="button"
            className="button outline"
            data-autofocus
            onClick={() => finish(false)}
          >
            취소
          </button>
          <button
            type="button"
            className={`button ${request?.tone === 'danger' ? 'itda-danger-button' : ''}`}
            onClick={() => finish(true)}
          >
            {request?.confirmLabel ?? '계속하기'}
          </button>
        </>
      }
    >
      <p>{request?.message}</p>
    </Modal>
  )
  return { ask, dialog, pending: Boolean(request) }
}

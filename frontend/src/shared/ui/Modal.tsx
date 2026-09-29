import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CircleAlert, X } from 'lucide-react'
import './modal.css'

let openDialogs = 0
let previousOverflow = ''

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  busy = false,
  size = 'default',
  tone = 'default',
  role = 'dialog',
  hideTitle = false,
  variant = 'default',
}: {
  open: boolean
  title: string
  onClose: () => void
  children?: ReactNode
  footer?: ReactNode
  busy?: boolean
  size?: 'default' | 'wide'
  tone?: 'default' | 'danger' | 'success'
  role?: 'dialog' | 'alertdialog'
  hideTitle?: boolean
  variant?: 'default' | 'message'
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    if (!open || !ref.current) return
    const dialog = ref.current
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (openDialogs++ === 0) {
      previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    dialog.showModal()
    const target =
      dialog.querySelector<HTMLElement>('[data-autofocus], [autofocus]') ??
      dialog.querySelector<HTMLElement>('h2')
    target?.focus({ preventScroll: true })
    return () => {
      dialog.close()
      if (--openDialogs === 0) document.body.style.overflow = previousOverflow
      requestAnimationFrame(() => {
        if (document.querySelector('dialog[open]')) return
        const current = document.activeElement
        if (
          current instanceof HTMLElement &&
          current !== document.body &&
          current.isConnected &&
          !current.closest('dialog:not([open]), [hidden], [inert]')
        )
          return
        const visible =
          previousFocus?.isConnected &&
          !previousFocus.closest('[hidden], [inert]') &&
          !previousFocus.matches(':disabled')
        if (visible) previousFocus.focus({ preventScroll: true })
        else
          document
            .querySelector<HTMLElement>('[data-page]:not([hidden]) h1')
            ?.focus({ preventScroll: true })
      })
    }
  }, [open])
  if (!open) return null
  return createPortal(
    <dialog
      ref={ref}
      className={`itda-modal is-${tone} ${size === 'wide' ? 'itda-modal-wide' : ''} ${variant === 'message' ? 'itda-modal-message' : ''} ${hideTitle ? 'itda-modal-compact' : ''}`}
      role={role}
      aria-modal="true"
      aria-label={hideTitle ? title : undefined}
      aria-labelledby={hideTitle ? undefined : titleId}
      aria-busy={busy || undefined}
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
    >
      <header className="itda-modal-heading">
        {!hideTitle && (
          <h2 id={titleId} tabIndex={-1}>
            {title}
          </h2>
        )}
        <button
          type="button"
          className="itda-modal-close"
          aria-label="닫기"
          disabled={busy}
          onClick={onClose}
        >
          <X size={22} aria-hidden="true" />
        </button>
      </header>
      {children && <div className="itda-modal-body">{children}</div>}
      {footer && <footer className="itda-modal-actions">{footer}</footer>}
    </dialog>,
    document.body,
  )
}

export function FeedbackDialog({
  message,
  onClose,
  title,
  tone = 'success',
  action,
}: {
  message: string
  onClose: () => void
  title?: string
  tone?: 'success' | 'error' | 'info'
  action?: { label: string; onClick: () => void; disabled?: boolean }
}) {
  return (
    <Modal
      open={Boolean(message)}
      title={
        title ??
        (tone === 'error' ? '다시 확인해 주세요' : tone === 'success' ? '완료했어요' : '안내')
      }
      onClose={onClose}
      tone={tone === 'error' ? 'danger' : tone === 'success' ? 'success' : 'default'}
      role={tone === 'error' ? 'alertdialog' : 'dialog'}
      variant="message"
      hideTitle={tone === 'success'}
      footer={
        <>
          {action && (
            <button
              type="button"
              className="button outline"
              disabled={action.disabled}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          )}
          <button type="button" className="button" data-autofocus onClick={onClose}>
            확인
          </button>
        </>
      }
    >
      <div className="itda-feedback">
        {tone !== 'success' && <CircleAlert size={28} aria-hidden="true" />}
        <p>{message}</p>
      </div>
    </Modal>
  )
}

import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { FeedbackDialog, Modal, useConfirmation } from '../src/shared/ui'

afterEach(cleanup)

it.each([
  ['추가했어요', '질문을 추가했어요.'],
  ['삭제했어요', '진료일을 삭제했어요.'],
  [undefined, '돌보는 분 이름을 저장했어요.'],
] as const)(
  '성공 안내 %s는 중복 제목 없이 결과를 한 번 표시하고 확인으로 닫는다',
  (title, message) => {
    const close = vi.fn()
    render(<FeedbackDialog title={title} message={message} onClose={close} />)
    const feedback = screen.getByRole('dialog', { name: title ?? '완료했어요' })
    expect(within(feedback).queryByRole('heading')).toBeNull()
    expect(within(feedback).getAllByText(message)).toHaveLength(1)
    const confirm = within(feedback).getByRole('button', { name: '확인', exact: true })
    expect(document.activeElement).toBe(confirm)
    fireEvent.click(confirm)
    expect(close).toHaveBeenCalledOnce()
  },
)

it('성공 안내의 추가 설명과 후속 동작을 보존하고 닫기와 Esc를 지원한다', () => {
  const close = vi.fn()
  const action = vi.fn()
  const message = '질문을 저장했어요.\n일부 목록을 새로 불러오지 못했어요. 다시 불러와 주세요.'
  render(
    <FeedbackDialog
      title="저장했어요"
      message={message}
      onClose={close}
      action={{ label: '다시 불러오기', onClick: action }}
    />,
  )
  const feedback = screen.getByRole('dialog', { name: '저장했어요' })
  expect(within(feedback).queryByRole('heading')).toBeNull()
  expect(within(feedback).getByText(/질문을 저장했어요/).textContent).toBe(message)
  fireEvent.click(within(feedback).getByRole('button', { name: '다시 불러오기' }))
  expect(action).toHaveBeenCalledOnce()
  expect(close).not.toHaveBeenCalled()
  fireEvent.click(within(feedback).getByRole('button', { name: '닫기' }))
  fireEvent(feedback, new Event('cancel', { cancelable: true }))
  expect(close).toHaveBeenCalledTimes(2)
})

it.each([
  ['error', 'alertdialog', '다시 확인해 주세요'],
  ['info', 'dialog', '안내'],
] as const)('%s 안내는 제목과 설명, 후속 동작의 잠금 상태를 유지한다', (tone, role, title) => {
  const action = vi.fn()
  render(
    <FeedbackDialog
      message="연결 상태를 확인한 후 다시 시도해 주세요."
      tone={tone}
      onClose={() => {}}
      action={{ label: '다시 시도', onClick: action, disabled: true }}
    />,
  )
  const feedback = screen.getByRole(role, { name: title })
  expect(within(feedback).getByRole('heading', { name: title })).toBeTruthy()
  expect(within(feedback).getByText('연결 상태를 확인한 후 다시 시도해 주세요.')).toBeTruthy()
  fireEvent.click(within(feedback).getByRole('button', { name: '다시 시도' }))
  expect(action).not.toHaveBeenCalled()
})

it('확인 중복 요청을 막고 취소는 실행하지 않으며 다음 요청을 다시 받을 수 있다', async () => {
  const decided = vi.fn()
  function Harness({ active = true }: { active?: boolean }) {
    const { ask, dialog } = useConfirmation(active)
    return (
      <>
        <button
          onClick={async () => {
            if (
              await ask({
                title: '삭제할까요?',
                message: '선택한 항목',
                confirmLabel: '삭제하기',
                tone: 'danger',
              })
            )
              decided()
          }}
        >
          삭제
        </button>
        {dialog}
      </>
    )
  }
  const view = render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: '삭제', exact: true }))
  const modal = screen.getByRole('alertdialog', { name: '삭제할까요?' })
  expect(modal.getAttribute('aria-modal')).toBe('true')
  expect(document.activeElement).toBe(within(modal).getByRole('button', { name: '취소' }))
  fireEvent.click(screen.getByRole('button', { name: '삭제', exact: true }))
  expect(screen.getAllByRole('alertdialog')).toHaveLength(1)
  fireEvent.click(within(modal).getByRole('button', { name: '취소' }))
  await act(async () => {})
  expect(decided).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '삭제', exact: true }))
  view.rerender(<Harness active={false} />)
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(decided).not.toHaveBeenCalled()
  view.rerender(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: '삭제', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: '삭제하기' }))
  await waitFor(() => expect(decided).toHaveBeenCalledOnce())
})

it('저장 중에는 Esc와 닫기를 막고 완료 뒤에는 닫을 수 있다', () => {
  const close = vi.fn()
  const view = render(
    <Modal open title="항목 수정" busy onClose={close}>
      <input aria-label="수정 값" defaultValue="보존" />
    </Modal>,
  )
  const modal = screen.getByRole('dialog', { name: '항목 수정' })
  fireEvent(modal, new Event('cancel', { cancelable: true }))
  fireEvent.click(screen.getByRole('button', { name: '닫기' }))
  expect(close).not.toHaveBeenCalled()
  expect((screen.getByLabelText('수정 값') as HTMLInputElement).value).toBe('보존')
  view.rerender(
    <Modal open title="항목 수정" onClose={close}>
      완료
    </Modal>,
  )
  fireEvent(modal, new Event('cancel', { cancelable: true }))
  expect(close).toHaveBeenCalledOnce()
})

it('여러 팝업에서 마지막 창을 닫을 때 원래 페이지 스크롤 상태를 복구한다', () => {
  document.body.style.overflow = 'auto'
  const view = render(
    <>
      <Modal open title="수정" onClose={() => {}} />
      <Modal open title="취소 확인" onClose={() => {}} />
    </>,
  )
  expect(document.body.style.overflow).toBe('hidden')
  view.rerender(
    <>
      <Modal open title="수정" onClose={() => {}} />
      <Modal open={false} title="취소 확인" onClose={() => {}} />
    </>,
  )
  expect(document.body.style.overflow).toBe('hidden')
  view.unmount()
  expect(document.body.style.overflow).toBe('auto')
  document.body.style.overflow = ''
})

it('닫기 뒤 사용자가 옮긴 입력 초점을 이전 버튼으로 빼앗지 않는다', () => {
  const frames: FrameRequestCallback[] = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback)
    return frames.length
  })
  function Harness({ open }: { open: boolean }) {
    return (
      <>
        <button>수정 열기</button>
        <input aria-label="다음 입력" />
        <Modal open={open} title="수정" onClose={() => {}} />
      </>
    )
  }
  const view = render(<Harness open={false} />)
  screen.getByRole('button', { name: '수정 열기' }).focus()
  view.rerender(<Harness open />)
  view.rerender(<Harness open={false} />)
  screen.getByLabelText('다음 입력').focus()
  act(() => frames.forEach((callback) => callback(0)))
  expect(document.activeElement).toBe(screen.getByLabelText('다음 입력'))
})

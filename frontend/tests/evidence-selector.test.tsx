import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EvidenceSelector } from '../src/features/records/EvidenceSelector'

const text = '밤에 두 번 깼어요.\n 아침에는 식사를 거부하셨어요. '
const source = () =>
  screen.getByRole('textbox', { name: '원문에서 근거 선택' }) as HTMLTextAreaElement
const selected = () => screen.getByRole('region', { name: '선택한 근거' })

function ControlledSelector({ onChange = () => {} }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState('')
  const [type, setType] = useState('야간 각성')
  return (
    <>
      <label>
        유형
        <select value={type} onChange={(event) => setType(event.target.value)}>
          <option>야간 각성</option>
          <option>식사량 감소</option>
        </select>
      </label>
      <EvidenceSelector
        text={text}
        value={value}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
      />
    </>
  )
}

afterEach(cleanup)

it('원문은 읽기 전용이며 직접 입력으로 근거를 만들 수 없다', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<EvidenceSelector text={text} value="" onChange={onChange} />)

  expect(source().readOnly).toBe(true)
  await user.type(source(), '원문에 없는 내용')
  expect(source().value).toBe(text)
  expect(onChange).not.toHaveBeenCalled()
  expect(selected().textContent).toContain('아직 선택한 구절이 없어요.')
})

it('선택 범위의 공백과 줄바꿈을 포함한 원문 구절을 그대로 전달한다', () => {
  const onChange = vi.fn()
  render(<ControlledSelector onChange={onChange} />)
  const start = text.indexOf('깼어요.')
  const end = text.indexOf('식사를')

  source().focus()
  source().setSelectionRange(start, end)
  fireEvent.select(source())

  expect(onChange).toHaveBeenLastCalledWith('깼어요.\n 아침에는 ')
  expect(selected().querySelector('p')?.textContent).toBe(text.slice(start, end))
})

it('키보드로 원문 구절을 선택할 수 있다', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<ControlledSelector onChange={onChange} />)
  await user.click(source())
  source().setSelectionRange(0, 0)

  await user.keyboard('{Shift>}{ArrowRight}{ArrowRight}{/Shift}')

  expect(onChange).toHaveBeenLastCalledWith('밤에')
  expect(selected().querySelector('p')?.textContent).toBe('밤에')
})

it('전체 선택을 방향키로 접은 뒤 원하는 구절만 다시 선택한다', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<ControlledSelector onChange={onChange} />)
  await user.click(source())
  source().setSelectionRange(0, text.length)
  fireEvent.select(source())
  expect(selected().querySelector('p')?.textContent).toBe(text)

  await user.keyboard('{ArrowLeft}')
  expect([source().selectionStart, source().selectionEnd]).toEqual([0, 0])
  expect(selected().querySelector('p')?.textContent).toBe(text)
  await user.keyboard('{Shift>}{ArrowRight}{ArrowRight}{/Shift}')
  expect(selected().querySelector('p')?.textContent).toBe('밤에')

  await user.keyboard('{ArrowRight}')
  expect([source().selectionStart, source().selectionEnd]).toEqual([2, 2])
  expect(selected().querySelector('p')?.textContent).toBe('밤에')
})

it('역방향 선택을 늘리고 줄이거나 기준점을 넘어도 같은 기준점을 유지한다', async () => {
  const user = userEvent.setup()
  render(<ControlledSelector />)
  await user.click(source())
  source().setSelectionRange(1, 3, 'backward')

  await user.keyboard('{Shift>}{ArrowLeft}{/Shift}')
  expect([source().selectionStart, source().selectionEnd, source().selectionDirection]).toEqual([
    0,
    3,
    'backward',
  ])
  await user.keyboard('{Shift>}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{/Shift}')
  expect([source().selectionStart, source().selectionEnd, source().selectionDirection]).toEqual([
    3,
    4,
    'forward',
  ])
  expect(selected().querySelector('p')?.textContent).toBe(text.slice(3, 4))
})

it('Home과 End는 현재 줄 경계로 움직이고 Shift 선택에 반영한다', async () => {
  const user = userEvent.setup()
  render(<ControlledSelector />)
  await user.click(source())
  const lineStart = text.indexOf('\n') + 1
  source().setSelectionRange(lineStart + 4, lineStart + 4)

  await user.keyboard('{Home}')
  expect([source().selectionStart, source().selectionEnd]).toEqual([lineStart, lineStart])
  await user.keyboard('{Shift>}{End}{/Shift}')
  expect(selected().querySelector('p')?.textContent).toBe(text.slice(lineStart))
  await user.keyboard('{Shift>}{Home}{/Shift}')
  expect([source().selectionStart, source().selectionEnd]).toEqual([lineStart, lineStart])
  // An empty range keeps the evidence already chosen.
  expect(selected().querySelector('p')?.textContent).toBe(text.slice(lineStart))
})

it('조합 한글과 결합 이모지는 하나의 글자로 이동하며 긴 원문의 끝에서도 경계를 지킨다', () => {
  const onChange = vi.fn()
  const prefix = '가나다 '.repeat(2000)
  const graphemes = ['한', '👨‍👩‍👧‍👦', '👍🏽', 'e\u0301']
  const unicodeText = prefix + graphemes.join('')
  render(<EvidenceSelector text={unicodeText} value="" onChange={onChange} />)
  source().focus()
  source().setSelectionRange(prefix.length, prefix.length)
  let end = prefix.length

  for (const grapheme of graphemes) {
    fireEvent.keyDown(source(), { key: 'ArrowRight', shiftKey: true })
    end += grapheme.length
    expect(source().selectionEnd).toBe(end)
    expect(onChange).toHaveBeenLastCalledWith(unicodeText.slice(prefix.length, end))
  }
  fireEvent.keyDown(source(), { key: 'ArrowRight', shiftKey: true })
  expect(source().selectionEnd).toBe(unicodeText.length)
  fireEvent.keyDown(source(), { key: 'ArrowLeft', shiftKey: true })
  expect(source().selectionEnd).toBe(unicodeText.length - graphemes.at(-1)!.length)
})

it('Tab과 복사·전체선택 및 수정키 단축키의 기본 동작을 막지 않는다', () => {
  render(<EvidenceSelector text={text} value="" onChange={vi.fn()} />)
  source().focus()
  source().setSelectionRange(0, 2)

  for (const key of [
    { key: 'Tab' },
    { key: 'c', metaKey: true },
    { key: 'a', metaKey: true },
    { key: 'c', ctrlKey: true },
    { key: 'ArrowLeft', altKey: true },
    { key: 'ArrowRight', ctrlKey: true },
    { key: 'Home', metaKey: true },
  ]) {
    expect(fireEvent.keyDown(source(), key)).toBe(true)
    expect([source().selectionStart, source().selectionEnd]).toEqual([0, 2])
  }
})

it('다른 입력으로 이동하거나 선택을 해제해도 선택한 근거가 유지된다', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<ControlledSelector onChange={onChange} />)
  source().focus()
  source().setSelectionRange(0, 11)
  fireEvent.select(source())
  const evidence = text.slice(0, 11)
  onChange.mockClear()

  await user.selectOptions(screen.getByLabelText('유형'), '식사량 감소')
  source().focus()
  source().setSelectionRange(3, 3)
  fireEvent.select(source())
  fireEvent.blur(source())

  expect(selected().querySelector('p')?.textContent).toBe(evidence)
  expect(onChange).not.toHaveBeenCalled()
})

it('포커스를 옮길 때 남은 기본 선택 범위도 읽고 공백뿐인 선택은 무시한다', () => {
  const onChange = vi.fn()
  render(<ControlledSelector onChange={onChange} />)
  source().setSelectionRange(0, 2)
  fireEvent.blur(source())
  expect(onChange).toHaveBeenLastCalledWith('밤에')
  onChange.mockClear()

  source().focus()
  const space = text.indexOf(' ')
  source().setSelectionRange(space, space + 1)
  fireEvent.select(source())
  fireEvent.blur(source())

  expect(onChange).not.toHaveBeenCalled()
  expect(selected().querySelector('p')?.textContent).toBe('밤에')
})

it('비활성 상태에서는 선택으로 근거를 변경하지 않는다', () => {
  const onChange = vi.fn()
  render(<EvidenceSelector text={text} value="밤에" onChange={onChange} disabled />)
  expect(source().disabled).toBe(true)
  source().setSelectionRange(0, text.length)
  expect(fireEvent.keyDown(source(), { key: 'ArrowLeft', shiftKey: true })).toBe(true)
  expect([source().selectionStart, source().selectionEnd]).toEqual([0, text.length])
  fireEvent.select(source())
  fireEvent.blur(source())
  expect(onChange).not.toHaveBeenCalled()
  expect(selected().querySelector('p')?.textContent).toBe('밤에')
})

it('원문이 바뀌면 이전 원문에만 있던 근거를 선택 결과로 표시하지 않는다', () => {
  const onChange = vi.fn()
  const { rerender } = render(<EvidenceSelector text={text} value="밤에" onChange={onChange} />)
  rerender(<EvidenceSelector text="저녁 식사를 잘 드셨어요." value="밤에" onChange={onChange} />)
  expect(source().value).toBe('저녁 식사를 잘 드셨어요.')
  expect(selected().textContent).toContain('아직 선택한 구절이 없어요.')
  expect(onChange).not.toHaveBeenCalled()
})

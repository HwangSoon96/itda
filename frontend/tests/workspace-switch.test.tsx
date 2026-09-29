import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import App from '../src/app/App'

const controls = vi.hoisted(() => ({ adoptWorkspace: vi.fn(), blockWorkspace: vi.fn() }))
const api = vi.hoisted(() => ({
  health: vi.fn(),
  patient: vi.fn(),
  loadDemo: vi.fn(),
  exitDemo: vi.fn(),
  savePatient: vi.fn(),
}))
vi.mock('../src/api', () => ({
  api,
  apiCapabilities: { workspace: true, patient: true, demo: true },
  USE_MOCK: false,
  ...controls,
}))
vi.mock('../src/features/records/RecordPage', () => ({
  RecordPage: ({ health }: { health: { demo_loaded: boolean } }) => {
    const [value, setValue] = useState('')
    return (
      <>
        <h1 data-testid="record-mode">{health?.demo_loaded ? '데모 기록 화면' : '내 기록 화면'}</h1>
        <input
          aria-label="검증 메모"
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            window.dispatchEvent(
              new CustomEvent('itda-final-dirty', {
                detail: { key: 'record', dirty: !!event.target.value },
              }),
            )
          }}
        />
      </>
    )
  },
}))
vi.mock('../src/features/schedule/SchedulePage', () => ({
  SchedulePage: () => (
    <>
      <h1 tabIndex={-1}>진료 준비 화면</h1>
      <details open>
        <summary>추가 질문</summary>
      </details>
    </>
  ),
}))
vi.mock('../src/features/summary/SummaryPage', () => ({
  SummaryPage: ({ active }: { active: boolean }) => {
    const [value, setValue] = useState('')
    return (
      <>
        <h1 tabIndex={-1}>요약 검증 화면</h1>
        <input
          aria-label="완료 요약 상태"
          data-active={String(active)}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </>
    )
  },
}))
const original = { ok: true, demo_loaded: false, workspace_id: 'original' }
const demo = { ok: true, demo_loaded: true, workspace_id: 'demo' }
beforeEach(() => {
  vi.resetAllMocks()
  location.hash = '#record'
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  api.patient.mockResolvedValue({ alias: '검증 대상' })
  api.health.mockResolvedValueOnce(original)
  api.loadDemo.mockResolvedValue({ ok: true, workspace_id: 'demo' })
})
afterEach(cleanup)

it('이름 수정 취소를 확인하고 저장 실패 시 같은 입력에서 다시 저장한다', async () => {
  api.savePatient
    .mockRejectedValueOnce(new Error('저장 연결 실패'))
    .mockResolvedValueOnce({ alias: '새 이름' })
  render(<App />)
  await screen.findByText('내 기록 화면')
  fireEvent.click(screen.getByText('관리'))
  fireEvent.click(screen.getByRole('button', { name: '돌보는 분 이름 설정' }))
  const editor = await screen.findByRole('dialog', { name: '돌보는 분 이름 설정' })
  fireEvent.change(within(editor).getByLabelText('이름 또는 가명'), {
    target: { value: '새 이름' },
  })
  fireEvent.click(within(editor).getByRole('button', { name: '취소' }))
  const cancel = await screen.findByRole('alertdialog', { name: '수정을 취소할까요?' })
  fireEvent.click(within(cancel).getByRole('button', { name: '취소', exact: true }))
  expect((within(editor).getByLabelText('이름 또는 가명') as HTMLInputElement).value).toBe(
    '새 이름',
  )
  fireEvent.click(within(editor).getByRole('button', { name: '저장', exact: true }))
  await within(editor).findByText('저장 연결 실패')
  expect((within(editor).getByLabelText('이름 또는 가명') as HTMLInputElement).value).toBe(
    '새 이름',
  )
  fireEvent.click(within(editor).getByRole('button', { name: '저장', exact: true }))
  await screen.findByText('돌보는 분 이름을 저장했어요.')
  expect(screen.queryByRole('dialog', { name: '돌보는 분 이름 설정' })).toBeNull()
  expect(api.savePatient.mock.calls).toEqual([[{ alias: '새 이름' }], [{ alias: '새 이름' }]])
})

it('이름 저장 중에는 닫기와 중복 요청을 막는다', async () => {
  let finish!: (patient: { alias: string }) => void
  api.savePatient.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  render(<App />)
  await screen.findByText('내 기록 화면')
  fireEvent.click(screen.getByText('관리'))
  fireEvent.click(screen.getByRole('button', { name: '돌보는 분 이름 설정' }))
  const editor = await screen.findByRole('dialog', { name: '돌보는 분 이름 설정' })
  const input = within(editor).getByLabelText('이름 또는 가명') as HTMLInputElement
  fireEvent.change(input, { target: { value: '새 이름' } })
  fireEvent.submit(input.closest('form')!)
  fireEvent.submit(input.closest('form')!)
  fireEvent(editor, new Event('cancel', { cancelable: true }))
  expect(api.savePatient).toHaveBeenCalledOnce()
  expect(screen.getByRole('dialog', { name: '돌보는 분 이름 설정' })).toBe(editor)
  expect(input.disabled).toBe(true)
  await act(async () => finish({ alias: '새 이름' }))
  await screen.findByText('돌보는 분 이름을 저장했어요.')
})

it('저장 전 시작한 이름 조회가 늦게 도착해도 저장한 이름을 되돌리지 않는다', async () => {
  let finishOldRead!: (patient: { alias: string }) => void
  api.health.mockResolvedValue(original)
  api.patient.mockResolvedValueOnce({ alias: '이전 이름' }).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOldRead = resolve
      }),
  )
  api.savePatient.mockResolvedValue({ alias: '저장한 이름' })
  render(<App />)
  await screen.findByText('내 기록 화면')
  fireEvent.click(screen.getByText('관리'))
  fireEvent.click(screen.getByRole('button', { name: '돌보는 분 이름 설정' }))
  const editor = await screen.findByRole('dialog', { name: '돌보는 분 이름 설정' })
  fireEvent.change(within(editor).getByLabelText('이름 또는 가명'), {
    target: { value: '저장한 이름' },
  })
  fireEvent.focus(window)
  await waitFor(() => expect(api.patient).toHaveBeenCalledTimes(2))
  fireEvent.click(within(editor).getByRole('button', { name: '저장', exact: true }))
  const success = await screen.findByRole('dialog', { name: '완료했어요' })
  expect(within(success).queryByRole('heading')).toBeNull()
  expect(within(success).getAllByText('돌보는 분 이름을 저장했어요.')).toHaveLength(1)
  await act(async () => finishOldRead({ alias: '이전 이름' }))
  fireEvent.click(within(success).getByRole('button', { name: '확인', exact: true }))
  fireEvent.click(screen.getByText('관리'))
  fireEvent.click(screen.getByRole('button', { name: '돌보는 분 이름 설정' }))
  expect((screen.getByLabelText('이름 또는 가명') as HTMLInputElement).value).toBe('저장한 이름')
})

it('저장하지 않은 입력이 있으면 모드 전환을 팝업에서 취소할 수 있다', async () => {
  api.health.mockResolvedValue(original)
  render(<App />)
  const input = (await screen.findByLabelText('검증 메모')) as HTMLInputElement
  fireEvent.change(input, { target: { value: '작성 중' } })
  fireEvent.click(screen.getByRole('button', { name: '데모 불러오기', exact: true }))
  const popup = await screen.findByRole('alertdialog', { name: '기록 공간을 바꿀까요?' })
  expect(api.loadDemo).not.toHaveBeenCalled()
  fireEvent.click(within(popup).getByRole('button', { name: '취소', exact: true }))
  expect(input.value).toBe('작성 중')
  expect(api.loadDemo).not.toHaveBeenCalled()
})

it('모드 전환과 연결 확인이 함께 실패해도 오류 팝업은 한 번만 표시한다', async () => {
  api.loadDemo.mockRejectedValue(new Error('데모 전환 실패'))
  api.health.mockRejectedValue(new Error('연결 확인 실패'))
  render(<App />)
  await screen.findByText('내 기록 화면')
  fireEvent.click(screen.getByRole('button', { name: '데모 불러오기', exact: true }))
  await waitFor(() =>
    expect(screen.getByRole('alertdialog').textContent).toContain('데모 전환 실패'),
  )
  expect(screen.getAllByRole('alertdialog')).toHaveLength(1)
  fireEvent.click(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: '확인', exact: true }),
  )
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

it('요약지 상태를 탭 이동에서는 유지하고 기록 공간을 바꾸면 새 상태로 시작한다', async () => {
  render(<App />)
  await screen.findByText('내 기록 화면')
  expect(screen.queryByLabelText('완료 요약 상태')).toBeNull()
  act(() => {
    location.hash = '#summary'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
  const completed = (await screen.findByLabelText('완료 요약 상태')) as HTMLInputElement
  fireEvent.change(completed, { target: { value: '완료된 요약' } })
  act(() => {
    location.hash = '#record'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
  expect(completed.closest('[hidden]')).not.toBeNull()
  expect(completed.dataset.active).toBe('false')
  act(() => {
    location.hash = '#summary'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
  expect(screen.getByLabelText('완료 요약 상태')).toBe(completed)
  expect(completed.value).toBe('완료된 요약')
  api.health.mockResolvedValue(demo)
  fireEvent.click(screen.getByRole('button', { name: '데모 불러오기', exact: true }))
  await waitFor(() => expect(screen.getByLabelText('완료 요약 상태')).not.toBe(completed))
  expect((screen.getByLabelText('완료 요약 상태') as HTMLInputElement).value).toBe('')
})

it('데모 전환 후 상태 조회가 실패하면 이전 모드로 입력하지 못하게 하고 재확인으로 복구한다', async () => {
  api.health.mockRejectedValue(new Error('연결 실패'))
  render(<App />)
  await screen.findByText('내 기록 화면')
  fireEvent.click(screen.getByText('관리'))
  fireEvent.click(screen.getByText('데모 기록 불러오기'))
  await waitFor(() => expect(api.loadDemo).toHaveBeenCalledOnce())
  await screen.findByText('연결 실패')
  expect(screen.queryByRole('heading', { name: '내 기록 화면' })).toBeNull()
  expect(screen.getByTestId('record-mode').closest('[hidden][inert]')).not.toBeNull()
  api.health.mockResolvedValue(demo)
  fireEvent.click(screen.getByRole('button', { name: '기록 공간 다시 확인' }))
  await screen.findByText('데모 기록 화면')
  expect(screen.getByLabelText('가상 기록으로 체험 중')).toBeTruthy()
})

it('전환 응답만 유실된 경우 서버 재확인 결과에 맞춰 데모 공간을 표시한다', async () => {
  api.loadDemo.mockRejectedValue(new Error('응답 유실'))
  api.health.mockResolvedValue(demo)
  render(<App />)
  await screen.findByText('내 기록 화면')
  fireEvent.click(screen.getByText('관리'))
  fireEvent.click(screen.getByText('데모 기록 불러오기'))
  await screen.findByText('데모 기록 화면')
  expect(screen.getByLabelText('가상 기록으로 체험 중')).toBeTruthy()
})

it('첫 health 채택 후에만 대상자를 조회하고 입력 화면을 연다', async () => {
  let finish!: (value: typeof original) => void
  api.health.mockReset().mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  render(<App />)
  expect(api.patient).not.toHaveBeenCalled()
  expect(screen.queryByLabelText('검증 메모')).toBeNull()
  await act(async () => finish(original))
  await screen.findByRole('heading', { name: '내 기록 화면' })
  expect(controls.adoptWorkspace).toHaveBeenCalledExactlyOnceWith('original')
  expect(controls.adoptWorkspace.mock.invocationCallOrder[0]).toBeLessThan(
    api.patient.mock.invocationCallOrder[0],
  )
})

it.each([false, true])(
  '포커스 복귀에서 공간 변경을 발견하면 입력을 보존하고 명시 복구까지 차단한다 (demo=%s)',
  async (isDemo) => {
    api.health.mockResolvedValue({ ...original, workspace_id: 'restarted', demo_loaded: isDemo })
    render(<App />)
    const input = (await screen.findByLabelText('검증 메모')) as HTMLInputElement
    fireEvent.change(input, { target: { value: '저장하지 않은 입력' } })
    fireEvent.focus(window)
    await screen.findByRole('heading', { name: '기록 공간이 바뀌었어요' })
    expect(input.value).toBe('저장하지 않은 입력')
    expect(input.closest('[hidden][inert]')).not.toBeNull()
    expect(api.patient).toHaveBeenCalledTimes(1)
    expect(controls.adoptWorkspace).toHaveBeenCalledExactlyOnceWith('original')
    fireEvent.click(screen.getByRole('button', { name: '기록 공간 다시 확인' }))
    const popup = await screen.findByRole('alertdialog', { name: '기록 공간을 다시 열까요?' })
    fireEvent.click(within(popup).getByRole('button', { name: '취소', exact: true }))
    expect(controls.adoptWorkspace).toHaveBeenCalledTimes(1)
    expect(input.value).toBe('저장하지 않은 입력')
    fireEvent.click(screen.getByRole('button', { name: '기록 공간 다시 확인' }))
    fireEvent.click(
      within(
        await screen.findByRole('alertdialog', { name: '기록 공간을 다시 열까요?' }),
      ).getByRole('button', { name: '기록 공간 열기' }),
    )
    await waitFor(() => expect(controls.adoptWorkspace).toHaveBeenLastCalledWith('restarted'))
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: '기록 공간이 바뀌었어요' })).toBeNull(),
    )
    const replacement = screen.getByLabelText('검증 메모') as HTMLInputElement
    expect(replacement).not.toBe(input)
    expect(replacement.value).toBe('')
    expect(replacement.closest('[hidden]')).toBeNull()
  },
)

it('API 불일치 알림도 입력을 보존하고 일반 연결 확인으로 새 공간을 채택하지 않는다', async () => {
  api.health.mockResolvedValue({ ...original, workspace_id: 'changed' })
  render(<App />)
  const input = (await screen.findByLabelText('검증 메모')) as HTMLInputElement
  fireEvent.change(input, { target: { value: '수정 중인 메모' } })
  act(() => window.dispatchEvent(new Event('itda-workspace-changed')))
  await screen.findByRole('heading', { name: '기록 공간이 바뀌었어요' })
  fireEvent.focus(window)
  await waitFor(() => expect(api.health).toHaveBeenCalledTimes(2))
  expect(controls.adoptWorkspace).toHaveBeenCalledExactlyOnceWith('original')
  expect(input.value).toBe('수정 중인 메모')
  expect(input.closest('[hidden][inert]')).not.toBeNull()
})

it('첫 대상자 조회 중 서버가 바뀌어도 빈 화면 대신 복구 동선을 표시한다', async () => {
  api.patient.mockImplementationOnce(async () => {
    window.dispatchEvent(new Event('itda-workspace-changed'))
    throw new Error('기록 공간 변경')
  })
  api.health.mockResolvedValue({ ...original, workspace_id: 'restarted' })
  render(<App />)
  await screen.findByRole('heading', { name: '기록 공간이 바뀌었어요' })
  expect(screen.queryByLabelText('검증 메모')).toBeNull()
  fireEvent.focus(window)
  await waitFor(() => expect(api.health).toHaveBeenCalledTimes(2))
  expect(controls.adoptWorkspace).toHaveBeenCalledExactlyOnceWith('original')
  fireEvent.click(screen.getByRole('button', { name: '기록 공간 다시 확인' }))
  await screen.findByRole('heading', { name: '내 기록 화면' })
  expect(controls.adoptWorkspace).toHaveBeenLastCalledWith('restarted')
})

it('명시 복구 중 포커스 이벤트가 새 조회를 끼워 넣지 않고 권한 오류가 나면 기존 입력을 계속 보존한다', async () => {
  api.health.mockResolvedValue({ ...original, workspace_id: 'restarted' })
  render(<App />)
  const input = (await screen.findByLabelText('검증 메모')) as HTMLInputElement
  fireEvent.change(input, { target: { value: '보존할 메모' } })
  fireEvent.focus(window)
  await screen.findByRole('heading', { name: '기록 공간이 바뀌었어요' })
  let rejectPatient!: (reason: Error) => void
  api.patient.mockReturnValueOnce(
    new Promise((_, reject) => {
      rejectPatient = reject
    }),
  )
  fireEvent.click(screen.getByRole('button', { name: '기록 공간 다시 확인' }))
  fireEvent.click(
    within(await screen.findByRole('alertdialog', { name: '기록 공간을 다시 열까요?' })).getByRole(
      'button',
      { name: '기록 공간 열기' },
    ),
  )
  await waitFor(() => expect(api.patient).toHaveBeenCalledTimes(2))
  const checks = api.health.mock.calls.length
  fireEvent.focus(window)
  expect(api.health).toHaveBeenCalledTimes(checks)
  const blockCount = controls.blockWorkspace.mock.calls.length
  await act(async () =>
    rejectPatient(Object.assign(new Error('대상자 조회 실패'), { status: 403 })),
  )
  await screen.findByText('대상자 조회 실패')
  expect(controls.blockWorkspace.mock.calls.length).toBeGreaterThan(blockCount)
  expect(input.value).toBe('보존할 메모')
  expect(input.closest('[hidden][inert]')).not.toBeNull()
  fireEvent.click(
    within(screen.getByRole('alertdialog', { name: 'PC 연결을 확인해 주세요' })).getByRole(
      'button',
      { name: '확인', exact: true },
    ),
  )
  fireEvent.click(screen.getByRole('button', { name: '기록 공간 다시 확인' }))
  fireEvent.click(
    within(await screen.findByRole('alertdialog', { name: '기록 공간을 다시 열까요?' })).getByRole(
      'button',
      { name: '기록 공간 열기' },
    ),
  )
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: '기록 공간이 바뀌었어요' })).toBeNull(),
  )
})

it.each(['#schedule', '#schedule?tab=questions'])(
  '페이지가 정한 질문 초점을 공통 제목 초점으로 빼앗지 않는다 (%s)',
  async (hash) => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    render(<App />)
    await screen.findByText('내 기록 화면')
    act(() => {
      location.hash = hash
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    const target = screen.getByText('추가 질문')
    target.focus()
    act(() => {
      frames.forEach((callback) => callback(0))
    })
    expect(document.activeElement).toBe(target)
  },
)

it('일반 페이지 이동에서 별도로 정한 초점이 없으면 제목에 초점을 둔다', async () => {
  const frames: FrameRequestCallback[] = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback)
    return frames.length
  })
  render(<App />)
  await screen.findByText('내 기록 화면')
  act(() => {
    location.hash = '#schedule'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
  act(() => {
    frames.forEach((callback) => callback(0))
  })
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: '진료 준비 화면' }))
})

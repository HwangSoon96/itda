import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import App from '../src/app/App'
import { useWorkspaceController } from '../src/app/useWorkspaceController'

const capabilities = vi.hoisted(() => ({ workspace: false, patient: true, demo: false }))
const controls = vi.hoisted(() => ({ adoptWorkspace: vi.fn(), blockWorkspace: vi.fn() }))
const api = vi.hoisted(() => ({
  health: vi.fn(),
  patient: vi.fn(),
  loadDemo: vi.fn(),
  exitDemo: vi.fn(),
  savePatient: vi.fn(),
}))
vi.mock('../src/api', () => ({ api, apiCapabilities: capabilities, USE_MOCK: false, ...controls }))
vi.mock('../src/features/records', () => ({
  RecordPage: ({ active }: { active: boolean }) => {
    const [value, setValue] = useState('')
    return (
      <>
        <h1 tabIndex={-1}>기록 화면</h1>
        <input
          aria-label="메모 입력"
          disabled={!active}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </>
    )
  },
}))
vi.mock('../src/features/schedule', () => ({ SchedulePage: () => <h1>일정 화면</h1> }))

const connected = { ok: true, ai_available: null }
beforeEach(() => {
  vi.resetAllMocks()
  Object.assign(capabilities, { workspace: false, patient: true, demo: false })
  window.history.replaceState(null, '', '#record')
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  api.health.mockResolvedValue(connected)
  api.patient.mockResolvedValue({ alias: '돌보는 분 이름' })
})
afterEach(cleanup)

it('작업 공간 기능이 없으면 식별자를 만들거나 채택하지 않고 화면을 연다', async () => {
  render(<App />)
  await screen.findByRole('heading', { name: '기록 화면' })
  expect(screen.getByText('모델 상태 미확인')).toBeTruthy()
  expect(screen.queryByText('모델 연결 필요')).toBeNull()
  expect(controls.adoptWorkspace).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: '데모 불러오기', exact: true })).toBeNull()
  fireEvent.click(screen.getByText('관리'))
  expect(screen.queryByRole('button', { name: '데모 기록 불러오기' })).toBeNull()
  act(() => window.dispatchEvent(new Event('itda-workspace-changed')))
  expect(screen.getByRole('heading', { name: '기록 화면' })).toBeTruthy()
  expect(controls.blockWorkspace).not.toHaveBeenCalled()
})

it.each([false, true])(
  '이름 조회 실패는 입력을 막지 않고 별도로 다시 불러올 수 있다 (workspace=%s)',
  async (workspace) => {
    capabilities.workspace = workspace
    api.health.mockResolvedValue({ ...connected, ...(workspace ? { workspace_id: 'space' } : {}) })
    api.patient
      .mockRejectedValueOnce(new Error('이름 조회 연결 실패'))
      .mockResolvedValueOnce({ alias: '다시 불러온 이름' })
    render(<App />)
    await screen.findByRole('heading', { name: '기록 화면' })
    expect(
      await screen.findByText('돌보는 분 이름을 불러오지 못했어요. 이름 조회 연결 실패'),
    ).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    const input = screen.getByLabelText('메모 입력') as HTMLInputElement
    fireEvent.change(input, { target: { value: '계속 작성하는 메모' } })
    expect(input.value).toBe('계속 작성하는 메모')
    fireEvent.click(screen.getByRole('button', { name: '이름 다시 불러오기' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '이름 다시 불러오기' })).toBeNull(),
    )
    fireEvent.click(screen.getByText('관리'))
    expect(await screen.findByText('다시 불러온 이름')).toBeTruthy()
    expect(api.health).toHaveBeenCalledTimes(1)
    expect(api.patient).toHaveBeenCalledTimes(2)
  },
)

it('작업 공간 확인이 필요 없으면 이름 조회 중에도 입력하고 저장한 이름을 늦은 조회가 되돌리지 않는다', async () => {
  let finishPatient!: (value: { alias: string }) => void
  api.patient.mockReturnValue(
    new Promise((resolve) => {
      finishPatient = resolve
    }),
  )
  api.savePatient.mockResolvedValue({ alias: '저장한 이름' })
  render(<App />)
  await screen.findByRole('heading', { name: '기록 화면' })
  expect((screen.getByLabelText('메모 입력') as HTMLInputElement).disabled).toBe(false)
  fireEvent.click(screen.getByText('관리'))
  fireEvent.click(screen.getByRole('button', { name: '돌보는 분 이름 설정' }))
  const editor = await screen.findByRole('dialog', { name: '돌보는 분 이름 설정' })
  fireEvent.change(within(editor).getByLabelText('이름 또는 가명'), {
    target: { value: '저장한 이름' },
  })
  fireEvent.click(within(editor).getByRole('button', { name: '저장', exact: true }))
  const notice = await screen.findByRole('dialog', { name: '완료했어요' })
  await act(async () => finishPatient({ alias: '느리게 도착한 이름' }))
  fireEvent.click(within(notice).getByRole('button', { name: '확인' }))
  fireEvent.click(screen.getByText('관리'))
  fireEvent.click(screen.getByRole('button', { name: '돌보는 분 이름 설정' }))
  expect((screen.getByLabelText('이름 또는 가명') as HTMLInputElement).value).toBe('저장한 이름')
})

it.each([{ status: 401 }, { status: 403 }, { code: 'workspace_changed' }])(
  '이름 조회의 접근 차단 오류는 일반 이름 오류로 삼키지 않는다 (%j)',
  async (detail) => {
    api.patient.mockRejectedValue(Object.assign(new Error('접근을 다시 확인해 주세요.'), detail))
    render(<App />)
    const error = await screen.findByRole('alertdialog', { name: 'PC 연결을 확인해 주세요' })
    expect(within(error).getByText('접근을 다시 확인해 주세요.')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '기록 화면' })).toBeNull()
    expect(screen.queryByRole('button', { name: '이름 다시 불러오기' })).toBeNull()
  },
)

it('이름 저장 권한 오류 뒤 늦은 초기 조회가 입력 화면을 다시 열지 않는다', async () => {
  let finishPatient!: (value: { alias: string }) => void
  api.patient.mockReturnValue(
    new Promise((resolve) => {
      finishPatient = resolve
    }),
  )
  api.savePatient.mockRejectedValue(
    Object.assign(new Error('이름 변경 권한이 없어요.'), { status: 403 }),
  )
  render(<App />)
  await screen.findByRole('heading', { name: '기록 화면' })
  fireEvent.click(screen.getByText('관리'))
  fireEvent.click(screen.getByRole('button', { name: '돌보는 분 이름 설정' }))
  const editor = await screen.findByRole('dialog', { name: '돌보는 분 이름 설정' })
  fireEvent.change(within(editor).getByLabelText('이름 또는 가명'), {
    target: { value: '새 이름' },
  })
  fireEvent.click(within(editor).getByRole('button', { name: '저장', exact: true }))
  const failure = await screen.findByRole('alertdialog', { name: 'PC 연결을 확인해 주세요' })
  expect(within(failure).getByText('이름 변경 권한이 없어요.')).toBeTruthy()
  expect(screen.queryByRole('heading', { name: '기록 화면' })).toBeNull()
  expect(
    (within(failure).getByRole('button', { name: '연결 다시 확인' }) as HTMLButtonElement).disabled,
  ).toBe(false)
  await act(async () => finishPatient({ alias: '늦게 도착한 이름' }))
  expect(screen.queryByRole('heading', { name: '기록 화면' })).toBeNull()
  expect(within(failure).getByText('이름 변경 권한이 없어요.')).toBeTruthy()
})

it('새 이름 저장이 성공하면 그전에 시작한 이름 조회의 인증 오류는 무시한다', async () => {
  let rejectPatient!: (reason: Error) => void
  api.patient.mockReturnValue(
    new Promise((_, reject) => {
      rejectPatient = reject
    }),
  )
  api.savePatient.mockResolvedValue({ alias: '저장한 이름' })
  const { result } = renderHook(() => useWorkspaceController())
  await waitFor(() => expect(result.current.workspaceReady).toBe(true))
  act(() => result.current.setAliasInput('저장한 이름'))
  await act(async () =>
    result.current.saveAlias({ preventDefault: vi.fn() } as unknown as FormEvent),
  )
  await act(async () =>
    rejectPatient(Object.assign(new Error('오래된 요청의 인증 오류'), { status: 401 })),
  )
  expect(result.current.workspaceReady).toBe(true)
  expect(result.current.alias).toBe('저장한 이름')
  expect(result.current.connectionError).toBe('')
  expect(result.current.patientError).toBe('')
  expect(result.current.patientLoading).toBe(false)
  expect(result.current.refreshing).toBe(false)
})

it('지원하지 않는 이름과 데모 기능은 UI와 직접 호출 모두 요청을 보내지 않는다', async () => {
  capabilities.patient = false
  const { result } = renderHook(() => useWorkspaceController())
  await waitFor(() => expect(result.current.workspaceReady).toBe(true))
  expect(result.current.health).toBe(connected)
  expect(Object.hasOwn(result.current.health!, 'workspace_id')).toBe(false)
  act(() => {
    result.current.setAliasInput('저장하지 않을 이름')
    result.current.openAlias()
  })
  await act(async () => {
    await result.current.saveAlias({ preventDefault: vi.fn() } as unknown as FormEvent)
    await result.current.switchDemo()
    await result.current.recoverWorkspace()
    await result.current.retryPatient()
  })
  expect(result.current.aliasOpen).toBe(false)
  expect(api.patient).not.toHaveBeenCalled()
  expect(api.savePatient).not.toHaveBeenCalled()
  expect(api.loadDemo).not.toHaveBeenCalled()
  expect(api.exitDemo).not.toHaveBeenCalled()
  expect(controls.adoptWorkspace).not.toHaveBeenCalled()
  cleanup()
  render(<App />)
  await screen.findByRole('heading', { name: '기록 화면' })
  fireEvent.click(screen.getByText('관리'))
  expect(screen.queryByRole('button', { name: '돌보는 분 이름 설정' })).toBeNull()
  expect(screen.queryByRole('button', { name: /데모/ })).toBeNull()
})

it('작업 공간 기능이 켜져 있으면 서버 식별자 없이 화면을 열지 않는다', async () => {
  capabilities.workspace = true
  render(<App />)
  await screen.findByRole('alertdialog', { name: 'PC 연결을 확인해 주세요' })
  expect(screen.queryByRole('heading', { name: '기록 화면' })).toBeNull()
  expect(api.patient).not.toHaveBeenCalled()
  expect(controls.adoptWorkspace).not.toHaveBeenCalled()
})

it('health가 준비되지 않았다고 응답하면 입력 화면을 열지 않는다', async () => {
  api.health.mockResolvedValue({ ok: false, ai_available: false })
  render(<App />)
  await screen.findByRole('alertdialog', { name: 'PC 연결을 확인해 주세요' })
  expect(screen.queryByRole('heading', { name: '기록 화면' })).toBeNull()
  expect(api.patient).not.toHaveBeenCalled()
})

it('열린 화면도 health가 준비되지 않으면 입력을 보존한 채 비활성화한다', async () => {
  render(<App />)
  await screen.findByRole('heading', { name: '기록 화면' })
  const input = screen.getByLabelText('메모 입력') as HTMLInputElement
  fireEvent.change(input, { target: { value: '보존할 메모' } })
  api.health.mockResolvedValue({ ok: false, ai_available: null })
  fireEvent.focus(window)
  await screen.findByRole('alertdialog', { name: 'PC 연결을 확인해 주세요' })
  expect(input.value).toBe('보존할 메모')
  expect(input.closest('[hidden][inert]')).not.toBeNull()
  expect(input.disabled).toBe(true)
})

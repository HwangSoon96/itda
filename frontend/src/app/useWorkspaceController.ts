import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { adoptWorkspace, api, apiCapabilities, blockWorkspace } from '../api'
import type { Health } from '../api/types'
import { useConfirmation } from '../shared/ui'
import { navigation, route } from './navigation'

function blocksPatientAccess(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const failure = error as { status?: unknown; code?: unknown }
  return failure.code === 'workspace_changed' || failure.status === 401 || failure.status === 403
}

export function useWorkspaceController() {
  const [currentHash, setCurrentHash] = useState(() => location.hash)
  const page = route(currentHash)
  const [summaryVisited, setSummaryVisited] = useState(page === 'summary')
  const pageOwnsFocus =
    page === 'schedule' &&
    new URLSearchParams(currentHash.split('?')[1] ?? '').get('tab') === 'questions'
  const [health, setHealth] = useState<Health | null>(null)
  const [connectionError, setConnectionError] = useState('')
  const [dismissedConnection, setDismissedConnection] = useState('')
  const [utilityNotice, setUtilityNotice] = useState('')
  const [refreshing, setRefreshing] = useState(true)
  const [alias, setAlias] = useState('')
  const [aliasInput, setAliasInput] = useState('')
  const [aliasOpen, setAliasOpen] = useState(false)
  const [patientError, setPatientError] = useState('')
  const [patientLoading, setPatientLoading] = useState(false)
  const [utilityError, setUtilityError] = useState('')
  const [busy, setBusy] = useState(false)
  const [workspace, setWorkspace] = useState(0)
  const [workspaceReady, setWorkspaceReady] = useState(false)
  const [workspaceChanged, setWorkspaceChanged] = useState(false)
  const healthRef = useRef<Health | null>(health)
  const workspaceBlocked = useRef(false)
  const authorizedSwitch = useRef(false)
  const refreshSequence = useRef(0)
  const switchingWorkspace = useRef(false)
  const aliasSaving = useRef(false)
  const aliasRevision = useRef(0)
  const patientSequence = useRef(0)
  const dirty = useRef(new Set<string>())
  const confirmation = useConfirmation()
  const utilityMenu = useRef<HTMLDetailsElement>(null)
  const blockCurrentWorkspace = useCallback(() => {
    if (!apiCapabilities.workspace) return
    blockWorkspace()
    workspaceBlocked.current = true
    refreshSequence.current += 1
    setWorkspaceReady(false)
    setWorkspaceChanged(true)
    setRefreshing(false)
  }, [])
  const handleAccessFailure = useCallback(
    (error: unknown) => {
      if (
        apiCapabilities.workspace &&
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'workspace_changed'
      ) {
        blockCurrentWorkspace()
      } else {
        refreshSequence.current += 1
      }
      patientSequence.current += 1
      setRefreshing(false)
      setPatientLoading(false)
      if (apiCapabilities.workspace && workspaceBlocked.current) blockWorkspace()
      setWorkspaceReady(false)
      setConnectionError(error instanceof Error ? error.message : '접근 권한을 확인해 주세요.')
    },
    [blockCurrentWorkspace],
  )
  const loadPatient = useCallback(async (sequence: number) => {
    if (!apiCapabilities.patient) return
    const requestSequence = ++patientSequence.current
    const patientRevision = aliasRevision.current
    setPatientLoading(true)
    setPatientError('')
    try {
      const patient = await api.patient()
      if (
        sequence === refreshSequence.current &&
        requestSequence === patientSequence.current &&
        patientRevision === aliasRevision.current
      ) {
        setAlias(patient.alias)
      }
    } catch (error) {
      if (
        sequence !== refreshSequence.current ||
        requestSequence !== patientSequence.current ||
        patientRevision !== aliasRevision.current
      )
        return
      if (blocksPatientAccess(error)) throw error
      setPatientError(error instanceof Error ? error.message : '이름을 불러오지 못했어요.')
    } finally {
      if (requestSequence === patientSequence.current) setPatientLoading(false)
    }
  }, [])
  const refresh = useCallback(
    async (allowAdopt = false) => {
      const sequence = ++refreshSequence.current
      setRefreshing(true)
      try {
        const next = await api.health()
        if (sequence !== refreshSequence.current) return null
        if (!next.ok) {
          setWorkspaceReady(false)
          throw new Error('서버가 아직 준비되지 않았어요. 연결을 다시 확인해 주세요.')
        }
        if (apiCapabilities.workspace && !next.workspace_id)
          throw new Error('기록 공간 정보를 확인하지 못했어요. 연결을 다시 확인해 주세요.')
        const previous = healthRef.current
        const changed =
          apiCapabilities.workspace &&
          previous &&
          (previous.workspace_id !== next.workspace_id ||
            (apiCapabilities.demo && Boolean(previous.demo_loaded) !== Boolean(next.demo_loaded)))
        if (apiCapabilities.workspace && !allowAdopt && (changed || workspaceBlocked.current)) {
          blockCurrentWorkspace()
          setConnectionError('')
          return null
        }
        const replace =
          apiCapabilities.workspace &&
          previous &&
          allowAdopt &&
          (changed || workspaceBlocked.current)
        // Health only identifies the server. Adoption is allowed on first load or explicit recovery.
        if (apiCapabilities.workspace && (!previous || allowAdopt))
          adoptWorkspace(next.workspace_id)
        // Optional patient metadata does not hold up a server without workspace negotiation.
        if (!apiCapabilities.workspace) {
          healthRef.current = next
          setHealth(next)
          setConnectionError('')
          setWorkspaceReady(true)
          setWorkspaceChanged(false)
        }
        await loadPatient(sequence)
        if (sequence !== refreshSequence.current) return null
        healthRef.current = next
        workspaceBlocked.current = false
        authorizedSwitch.current = false
        setHealth(next)
        setConnectionError('')
        setWorkspaceChanged(false)
        setWorkspaceReady(true)
        if (replace) {
          dirty.current.clear()
          setAliasOpen(false)
          setWorkspace((value) => value + 1)
        }
        return next
      } catch (error) {
        if (sequence === refreshSequence.current) {
          if (blocksPatientAccess(error)) handleAccessFailure(error)
          else {
            if (apiCapabilities.workspace && workspaceBlocked.current) blockWorkspace()
            setConnectionError(error instanceof Error ? error.message : 'PC 연결을 확인해 주세요.')
          }
        }
        return null
      } finally {
        if (sequence === refreshSequence.current) setRefreshing(false)
      }
    },
    [blockCurrentWorkspace, handleAccessFailure, loadPatient],
  )
  useEffect(() => {
    void refresh()
    const onHash = () => {
      setCurrentHash(location.hash)
      if (route(location.hash) === 'summary') setSummaryVisited(true)
      window.scrollTo({ top: 0 })
    }
    const onDirty = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; dirty: boolean }>).detail
      if (detail.dirty) dirty.current.add(detail.key)
      else dirty.current.delete(detail.key)
    }
    const onUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current.size) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    const onFocus = () => {
      if (!switchingWorkspace.current) void refresh()
    }
    window.addEventListener('itda-workspace-changed', blockCurrentWorkspace)
    window.addEventListener('hashchange', onHash)
    window.addEventListener('itda-final-dirty', onDirty)
    window.addEventListener('beforeunload', onUnload)
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('itda-workspace-changed', blockCurrentWorkspace)
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('itda-final-dirty', onDirty)
      window.removeEventListener('beforeunload', onUnload)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh, blockCurrentWorkspace])
  useEffect(() => {
    utilityMenu.current?.removeAttribute('open')
    document.title = `잇다 · ${navigation.find((item) => item.key === page)!.label}`
    // A deep link owns its destination focus; ordinary navigation starts at the page title.
    if (pageOwnsFocus) return
    const frame = requestAnimationFrame(() => {
      const surface = document.querySelector<HTMLElement>(`[data-page="${page}"]:not([hidden])`)
      if (!surface || surface.contains(document.activeElement)) return
      surface.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [page, pageOwnsFocus])
  useEffect(() => {
    if (!connectionError) setDismissedConnection('')
  }, [connectionError])
  useEffect(() => {
    if (aliasOpen && aliasInput !== alias) dirty.current.add('alias')
    else dirty.current.delete('alias')
  }, [aliasOpen, aliasInput, alias])
  async function recoverWorkspace() {
    if (!apiCapabilities.workspace || busy || refreshing || switchingWorkspace.current) return
    if (
      !authorizedSwitch.current &&
      dirty.current.size &&
      !(await confirmation.ask({
        title: '기록 공간을 다시 열까요?',
        message: '저장하지 않은 입력은 닫혀요. 저장된 메모는 남아 있어요.',
        confirmLabel: '기록 공간 열기',
      }))
    )
      return
    switchingWorkspace.current = true
    setBusy(true)
    try {
      if (await refresh(true)) setUtilityError('')
    } finally {
      switchingWorkspace.current = false
      setBusy(false)
    }
  }
  async function switchDemo() {
    if (!apiCapabilities.demo || busy || switchingWorkspace.current || !workspaceReady) return
    if (
      dirty.current.size &&
      !(await confirmation.ask({
        title: '기록 공간을 바꿀까요?',
        message: '저장하지 않은 입력은 닫혀요. 내 기록과 데모 기록은 따로 보관돼요.',
        confirmLabel: '바꾸기',
      }))
    )
      return
    if (!workspaceReady || workspaceBlocked.current || switchingWorkspace.current) return
    const previousMode = health?.demo_loaded
    authorizedSwitch.current = true
    switchingWorkspace.current = true
    refreshSequence.current += 1
    utilityMenu.current?.removeAttribute('open')
    setBusy(true)
    setUtilityError('')
    setWorkspaceReady(false)
    let switched = false
    try {
      if (health?.demo_loaded) await api.exitDemo()
      else await api.loadDemo()
      switched = true
    } catch (error) {
      setUtilityError(error instanceof Error ? error.message : '전환하지 못했어요.')
    } finally {
      if (apiCapabilities.workspace) {
        blockWorkspace()
        workspaceBlocked.current = true
      }
      const current = await refresh(true)
      if (current && (switched || current.demo_loaded !== previousMode)) {
        if (!apiCapabilities.workspace) {
          dirty.current.clear()
          setAliasOpen(false)
          setWorkspace((value) => value + 1)
        }
        setUtilityError('')
        setUtilityNotice(
          current.demo_loaded
            ? '데모 기록을 열었어요. 내 기록은 그대로 보관돼요.'
            : '내 기록으로 돌아왔어요.',
        )
      }
      switchingWorkspace.current = false
      setBusy(false)
    }
  }
  async function saveAlias(event: FormEvent) {
    event.preventDefault()
    if (
      !apiCapabilities.patient ||
      !aliasInput.trim() ||
      busy ||
      aliasSaving.current ||
      !workspaceReady
    )
      return
    aliasSaving.current = true
    setBusy(true)
    setUtilityError('')
    try {
      const patient = await api.savePatient({ alias: aliasInput.trim() })
      aliasRevision.current++
      setAlias(patient.alias)
      setPatientError('')
      setAliasOpen(false)
      setUtilityNotice('돌보는 분 이름을 저장했어요.')
      window.dispatchEvent(new Event('itda-final-updated'))
    } catch (error) {
      if (blocksPatientAccess(error)) handleAccessFailure(error)
      else setUtilityError(error instanceof Error ? error.message : '저장하지 못했어요.')
    } finally {
      aliasSaving.current = false
      setBusy(false)
    }
  }
  async function closeAlias() {
    if (!apiCapabilities.patient || busy) return
    if (
      aliasInput !== alias &&
      !(await confirmation.ask({
        title: '수정을 취소할까요?',
        message: '저장하지 않은 이름 변경은 사라져요.',
        confirmLabel: '수정 취소',
      }))
    )
      return
    setAliasOpen(false)
    setUtilityError('')
  }
  const connectionNotice = connectionError !== dismissedConnection ? connectionError : ''

  function openAlias() {
    if (!apiCapabilities.patient || !workspaceReady || busy) return
    utilityMenu.current?.removeAttribute('open')
    setAliasInput(alias)
    setUtilityError('')
    setAliasOpen(true)
  }
  async function retryPatient() {
    if (!apiCapabilities.patient || !workspaceReady || patientLoading || busy) return
    try {
      await loadPatient(refreshSequence.current)
    } catch (error) {
      handleAccessFailure(error)
    }
  }
  function retryConnection() {
    setDismissedConnection('')
    void refresh()
  }
  function dismissFeedback() {
    setUtilityError('')
    setUtilityNotice('')
    setDismissedConnection(connectionError)
  }
  function retryFeedback() {
    setUtilityError('')
    void refresh()
  }

  return {
    page,
    summaryVisited,
    health,
    connectionError,
    refreshing,
    alias,
    aliasInput,
    setAliasInput,
    aliasOpen,
    patientError,
    patientLoading,
    utilityError,
    utilityNotice,
    busy,
    workspace,
    workspaceReady,
    workspaceChanged,
    utilityMenu,
    confirmation,
    connectionNotice,
    switchDemo,
    recoverWorkspace,
    saveAlias,
    closeAlias,
    openAlias,
    retryConnection,
    retryPatient,
    dismissFeedback,
    retryFeedback,
  }
}

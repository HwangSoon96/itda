import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import { api } from '../../api'
import { EVENT_TYPES } from '../../api/types'
import { localToday } from '../../shared/lib/date'
import { reportHref } from '../../shared/lib/reportSelection'
import type { EventCard, Health, MemoResult, Question } from '../../api/types'
import { FeedbackDialog, Modal, useConfirmation } from '../../shared/ui'
import { EvidenceSelector } from './EvidenceSelector'
import '../../shared/styles/record-schedule.css'
import './record-improvements.css'
import './record.css'

type EditableEvent = EventCard & { uiKey: string }
// Persist only editable API fields; revisions and server records may carry extra metadata.
const apiEvent = (event: EventCard): EventCard => ({
  type: event.type,
  status: event.status,
  time_expr: event.time_expr,
  count: event.count,
  evidence: event.evidence,
  ...(Object.hasOwn(event, 'model_event_index')
    ? { model_event_index: event.model_event_index }
    : {}),
})
// Keep negative observations in the original response/history, but only review
// occurrences. Preserve model indices so filtering cannot change attribution.
const occurred = (events: EventCard[]) => events.filter((event) => event.status === '있었음')
const editable = (events: EventCard[]): EditableEvent[] =>
  occurred(events).map((event) => ({ ...apiEvent(event), uiKey: crypto.randomUUID() }))
const newManualEvent = (): EventCard => ({
  type: EVENT_TYPES[0],
  status: '있었음',
  count: 1,
  time_expr: null,
  evidence: '',
  model_event_index: null,
})
function linkedMemoId() {
  const [page, query] = location.hash.slice(1).split('?')
  const params = new URLSearchParams(query)
  const value = params.get('memo')
  return page === 'record' &&
    value &&
    /^[1-9]\d*$/.test(value) &&
    Number.isSafeInteger(Number(value))
    ? Number(value)
    : null
}
function linkedHistory() {
  const [page, query] = location.hash.slice(1).split('?')
  const params = new URLSearchParams(query)
  if (page !== 'record' || params.get('view') !== 'history') return null
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const validDate = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  return validDate(from) && validDate(to) && from <= to && to <= localToday()
    ? { from, to }
    : { from: '', to: '' }
}
function showHistoryHash() {
  const [page, query] = location.hash.slice(1).split('?')
  if (page !== 'record') return
  const params = new URLSearchParams(query)
  params.set('view', 'history')
  params.delete('memo')
  params.delete('return_to')
  params.delete('from')
  params.delete('to')
  const oldURL = location.href
  window.history.replaceState(null, '', `#record?${params}`)
  window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: location.href }))
}
function replaceMemoHash(id: number | null, view?: 'write' | 'history') {
  const [page, query] = location.hash.slice(1).split('?')
  if (page !== 'record') return
  const params = new URLSearchParams(query)
  if (view === 'history') params.set('view', 'history')
  if (view === 'write') {
    params.delete('view')
    params.delete('from')
    params.delete('to')
  }
  if (id === null) {
    params.delete('memo')
    params.delete('return_to')
  } else params.set('memo', String(id))
  const next = `#record${params.size ? `?${params}` : ''}`
  if (location.hash === next) return
  const oldURL = location.href
  window.history.replaceState(null, '', next)
  window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: location.href }))
}
function printReviewReturnHref() {
  const [page, query] = location.hash.slice(1).split('?')
  return page === 'record' && new URLSearchParams(query).get('return_to') === 'summary-print'
    ? reportHref('summary', { review: 'print' })
    : null
}
function replaceRouteHash(hash: string) {
  const oldURL = location.href
  window.history.replaceState(null, '', hash)
  window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: location.href }))
}
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : '연결을 확인하고 다시 시도해 주세요.'
const formatDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
const shortDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })
function daysBefore(date: string, days: number) {
  const value = new Date(`${date}T12:00:00`)
  value.setDate(value.getDate() - days)
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}
const failureMessages: Record<NonNullable<MemoResult['failure_code']>, string> = {
  connection_error: '이 PC의 AI 정리 프로그램에 연결하지 못했어요.',
  model_not_found: '이 PC에 AI 정리 모델이 준비되지 않았어요.',
  timeout: 'AI 정리에 시간이 오래 걸려 멈췄어요.',
  invalid_format: 'AI가 읽을 수 있는 형식으로 답하지 못했어요.',
  evidence_mismatch: 'AI가 메모에 없는 내용을 넣어 정리를 마치지 못했어요.',
  time_mismatch: 'AI가 메모에 없는 시간 표현을 넣어 정리를 마치지 못했어요.',
  interrupted: '프로그램이 중단되어 정리를 마치지 못했어요.',
  unknown_error: '실패 원인을 확인할 수 없어요.',
}
const updated = () => window.dispatchEvent(new Event('itda-final-updated'))

function Highlight({ text, evidence }: { text: string; evidence: string }) {
  const index = evidence ? text.indexOf(evidence) : -1
  if (index < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + evidence.length)}</mark>
      {text.slice(index + evidence.length)}
    </>
  )
}
function EvidenceExcerpt({ text, evidence }: { text: string; evidence: string }) {
  const index = text.indexOf(evidence)
  if (!evidence || index < 0) return <>{evidence}</>
  const start = Math.max(0, index - 24)
  const end = Math.min(text.length, index + evidence.length + 24)
  return (
    <>
      {start > 0 && '…'}
      <Highlight text={text.slice(start, end)} evidence={evidence} />
      {end < text.length && '…'}
    </>
  )
}

function EventFields({
  event,
  index,
  text,
  onChange,
  disabled = false,
}: {
  event: EventCard
  index: string
  text: string
  onChange: (event: EventCard) => void
  disabled?: boolean
}) {
  const patch = (values: Partial<EventCard>) => onChange({ ...event, ...values })
  return (
    <fieldset className="mvp-rc-fields" disabled={disabled}>
      <EvidenceSelector
        text={text}
        value={event.evidence}
        onChange={(evidence) => patch({ evidence })}
        disabled={disabled}
      />
      <div className="mvp-rc-field-grid">
        <label htmlFor={`${index}-type`}>
          유형
          <select
            id={`${index}-type`}
            value={event.type}
            onChange={(e) => patch({ type: e.target.value as EventCard['type'] })}
          >
            {EVENT_TYPES.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
        </label>
        <label htmlFor={`${index}-count`}>
          횟수
          <input
            id={`${index}-count`}
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            required
            value={event.count || ''}
            onChange={(e) => patch({ count: Number(e.target.value) })}
          />
          <span className="mvp-rc-hint">횟수를 적지 않았다면 기본값은 1이에요.</span>
        </label>
      </div>
      <label htmlFor={`${index}-time`}>
        원문 시간 표현 <span className="mvp-rc-optional">선택</span>
        <input
          id={`${index}-time`}
          value={event.time_expr ?? ''}
          maxLength={200}
          placeholder="예: 새벽 3시, 저녁"
          onChange={(e) => patch({ time_expr: e.target.value || null })}
        />
      </label>
    </fieldset>
  )
}

function EventSnapshot({ events }: { events: EventCard[] }) {
  return events.length ? (
    <ol className="mvp-rc-snapshot">
      {events.map((event, index) => (
        <li key={index}>
          <strong>
            {event.type}
            {event.status === '없었음' && ' · 없었음'}
          </strong>
          {event.status === '있었음' && <p>{event.count}회</p>}
          {event.time_expr && <p>원문 시간 표현: {event.time_expr}</p>}
          <q>{event.evidence}</q>
        </li>
      ))}
    </ol>
  ) : (
    <p>사건 없음</p>
  )
}
function ReviewCard({
  event,
  number,
  text,
  disabled,
  onDelete,
  onEdit,
}: {
  event: EditableEvent
  number: number
  text: string
  disabled: boolean
  onDelete: () => void
  onEdit: () => void
}) {
  return (
    <section
      className="card mvp-rc-event mvp-rc-review-card"
      aria-label={`${number}번 ${event.type}`}
    >
      <h3>{event.type}</h3>
      <fieldset className="mvp-rc-fields" disabled={disabled}>
        <div className="mvp-rc-occurrence">
          <span className="mvp-rc-time-expression">{event.time_expr || '시간 표현 없음'}</span>
          <span className="mvp-rc-time-expression">{event.count}회</span>
        </div>
        <q className="mvp-rc-event-quote" aria-label="근거 원문">
          <EvidenceExcerpt text={text} evidence={event.evidence} />
        </q>
        <div className="mvp-rc-card-actions">
          <button
            className="mvp-rc-edit-button"
            type="button"
            aria-label={`${number}번 ${event.type} 수정`}
            onClick={onEdit}
          >
            <Pencil size={15} aria-hidden="true" />
            내용 수정
          </button>
          <button
            type="button"
            className="mvp-rc-delete-button"
            aria-label={`${number}번 ${event.type} 카드 삭제`}
            onClick={onDelete}
          >
            <Trash2 size={15} aria-hidden="true" />
            카드 삭제
          </button>
        </div>
      </fieldset>
    </section>
  )
}
export function RecordPage({ health, active = true }: { health: Health | null; active?: boolean }) {
  const { ask, dialog: confirmationDialog, pending: confirmationPending } = useConfirmation(active)
  const activeRef = useRef(active)
  activeRef.current = active
  const transitionBusy = useRef(false)
  const navigationVersion = useRef(0)
  const [editingEvent, setEditingEvent] = useState<EditableEvent | null>(null)
  const [editingError, setEditingError] = useState('')
  const [sourceDraft, setSourceDraft] = useState<string | null>(null)
  const [sourceError, setSourceError] = useState('')
  const sourceRequest = useRef({ signature: '', id: '' })
  const [view, setView] = useState<'write' | 'history'>(() =>
    linkedHistory() ? 'history' : 'write',
  )
  const [text, setText] = useState('')
  const [recordDate, setRecordDate] = useState(localToday)
  const [today, setToday] = useState(localToday)
  const [dateChosen, setDateChosen] = useState(false)
  const [result, setResult] = useState<MemoResult | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewOrigin, setReviewOrigin] = useState<'compose' | 'saved'>('compose')
  const reviewOriginRef = useRef(reviewOrigin)
  reviewOriginRef.current = reviewOrigin
  const returnFromSavedReview = useRef<(view: 'write' | 'history') => void>(() => {})
  const reviewLocation = useRef(location.hash)
  const reviewReturnHref = useRef<string | null>(null)
  const feedbackReturnHref = useRef<string | null>(null)
  const appliedHistoryLink = useRef(JSON.stringify(linkedHistory()))
  const [events, setEvents] = useState<EditableEvent[]>([])
  const [editMode, setEditMode] = useState<'confirmed' | 'failed' | null>(null)
  const [reviewingChanges, setReviewingChanges] = useState(false)
  const [busy, setBusy] = useState<
    'create' | 'retry' | 'confirm' | 'add' | 'question' | 'delete' | 'update' | null
  >(null)
  const [questionText, setQuestionText] = useState('')
  const [questionError, setQuestionError] = useState('')
  const [questionNotice, setQuestionNotice] = useState('')
  const [savedQuestions, setSavedQuestions] = useState<Question[]>([])
  const [questionsOpen, setQuestionsOpen] = useState(false)
  const [questionsLoading, setQuestionsLoading] = useState(true)
  const [questionsLoadError, setQuestionsLoadError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [history, setHistory] = useState<MemoResult[]>([])
  const [historyError, setHistoryError] = useState('')
  const [historyLoading, setHistoryLoading] = useState(true)
  const [from, setFrom] = useState(() => linkedHistory()?.from ?? '')
  const [to, setTo] = useState(() => linkedHistory()?.to ?? '')
  const [range, setRange] = useState<'7' | '30' | 'custom'>(() =>
    linkedHistory()?.from ? 'custom' : '30',
  )
  const [historyPage, setHistoryPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('전체')
  const [manual, setManual] = useState<EventCard | null>(null)
  const [manualError, setManualError] = useState('')
  const request = useRef({ signature: '', id: '' })
  const requestBusy = useRef(false)
  const historyRequest = useRef(0)
  const questionsRequest = useRef(0)
  const topRef = useRef<HTMLDivElement>(null)
  const historyStart = useRef<HTMLParagraphElement>(null)
  const autoRecordDate = useRef(true)
  const currentDraft = useRef({ saved: false, busy: false })
  currentDraft.current = { saved: Boolean(result), busy: Boolean(busy) }
  const selectedMemoId = useRef<number | null>(null)
  const [linkTarget, setLinkTarget] = useState(() => ({ id: linkedMemoId(), request: 0 }))
  const handledLink = useRef(-1)
  const reviewDirty = Boolean(
    editingEvent ||
    sourceDraft !== null ||
    manual ||
    editMode ||
    (!result && (text.trim() || dateChosen)) ||
    result?.status === '확인 대기',
  )
  const dirty = Boolean(busy || reviewDirty || questionText.trim())
  const readonly = result?.status === '확인 완료' && editMode !== 'confirmed'
  const reviewable = result?.status === '확인 대기' || editMode !== null
  const emergency =
    result?.emergency.matched ||
    Boolean(health?.emergency_keywords.some((keyword) => text.includes(keyword)))
  const failureCode = result?.failure_code ?? 'unknown_error'
  const failureMessage =
    result?.failure_code == null
      ? '이전 실패의 원인은 확인할 수 없어요.'
      : Object.hasOwn(failureMessages, failureCode)
        ? failureMessages[failureCode]
        : failureMessages.unknown_error

  const refreshHistory = useCallback(async () => {
    const currentRequest = ++historyRequest.current
    setHistoryLoading(true)
    try {
      const memos = await api.memos({})
      if (currentRequest === historyRequest.current) {
        setHistory(memos)
        setHistoryError('')
      }
    } catch (err) {
      if (currentRequest === historyRequest.current) setHistoryError(messageOf(err))
    } finally {
      if (currentRequest === historyRequest.current) setHistoryLoading(false)
    }
  }, [])

  const refreshQuestions = useCallback(async () => {
    const currentRequest = ++questionsRequest.current
    setQuestionsLoading(true)
    try {
      const questions = await api.questions()
      if (currentRequest === questionsRequest.current) {
        setSavedQuestions([...questions])
        setQuestionsLoadError('')
      }
    } catch (err) {
      if (currentRequest === questionsRequest.current)
        setQuestionsLoadError(`저장한 질문을 불러오지 못했어요. ${messageOf(err)}`)
    } finally {
      if (currentRequest === questionsRequest.current) setQuestionsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshQuestions()
    window.addEventListener('itda-final-updated', refreshQuestions)
    return () => {
      questionsRequest.current++
      window.removeEventListener('itda-final-updated', refreshQuestions)
    }
  }, [refreshQuestions])

  useEffect(() => {
    void refreshHistory()
    window.addEventListener('itda-final-updated', refreshHistory)
    return () => window.removeEventListener('itda-final-updated', refreshHistory)
  }, [refreshHistory])
  useEffect(() => {
    if (!active) {
      reviewReturnHref.current = null
      feedbackReturnHref.current = null
    }
  }, [active])
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('itda-final-dirty', { detail: { key: 'record', dirty } }))
    return () => {
      window.dispatchEvent(
        new CustomEvent('itda-final-dirty', { detail: { key: 'record', dirty: false } }),
      )
    }
  }, [dirty])
  useEffect(() => {
    setHistoryPage(1)
  }, [range, from, to, statusFilter, today])

  useEffect(() => {
    let timer = 0
    const refreshDate = () => {
      const next = localToday()
      setToday(next)
      if (autoRecordDate.current && !currentDraft.current.saved && !currentDraft.current.busy)
        setRecordDate(next)
      clearTimeout(timer)
      const midnight = new Date()
      midnight.setHours(24, 0, 0, 50)
      timer = window.setTimeout(refreshDate, midnight.getTime() - Date.now())
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshDate()
    }
    refreshDate()
    window.addEventListener('focus', refreshDate)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', refreshDate)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  useEffect(() => {
    const onHash = () => {
      const id = linkedMemoId()
      const historyLink = linkedHistory()
      if (!printReviewReturnHref()) {
        reviewReturnHref.current = null
        feedbackReturnHref.current = null
      }
      if (
        location.hash.slice(1).split('?')[0] === 'record' &&
        id === null &&
        selectedMemoId.current !== null &&
        reviewOriginRef.current === 'saved'
      ) {
        returnFromSavedReview.current(historyLink ? 'history' : 'write')
        return
      }
      const historyKey = JSON.stringify(historyLink)
      const changedHistoryLink = appliedHistoryLink.current !== historyKey
      appliedHistoryLink.current = historyKey
      if (historyLink) {
        setView('history')
        if (changedHistoryLink && historyLink.from && historyLink.to) {
          setFrom(historyLink.from)
          setTo(historyLink.to)
          setRange('custom')
          setStatusFilter('전체')
        }
      } else if (location.hash.slice(1).split('?')[0] === 'record' && id === null) {
        setView('write')
      }
      // Internal URL updates also notify App, but must not reopen an edited memo.
      if (id !== selectedMemoId.current) {
        navigationVersion.current += 1
        setLinkTarget((previous) => ({ id, request: previous.request + 1 }))
      }
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const showResult = (memo: MemoResult, origin = reviewOrigin) => {
    reviewReturnHref.current =
      origin === 'saved' && linkedMemoId() === memo.memo_id ? printReviewReturnHref() : null
    selectedMemoId.current = memo.memo_id
    reviewOriginRef.current = origin
    setReviewOrigin(origin)
    autoRecordDate.current = false
    setDateChosen(false)
    setResult(memo)
    setReviewOpen(true)
    setText(memo.text)
    setRecordDate(memo.record_date)
    setEvents(editable(memo.events))
    setEditingEvent(null)
    setEditingError('')
    setSourceDraft(null)
    setSourceError('')
    sourceRequest.current = { signature: '', id: '' }
    setManual(null)
    setEditMode(null)
    setReviewingChanges(false)
    replaceMemoHash(memo.memo_id)
    reviewLocation.current = location.hash
  }
  const acceptSavedMemo = (memo: MemoResult, open = true, origin = reviewOrigin) => {
    // A committed response remains authoritative if the following list refresh
    // fails. Discard any list request begun before this save as well.
    historyRequest.current += 1
    setHistory((previous) => [memo, ...previous.filter((item) => item.memo_id !== memo.memo_id)])
    setHistoryError('')
    setHistoryLoading(false)
    if (open) showResult(memo, origin)
  }
  const startEdit = (mode: 'confirmed' | 'failed') => {
    if (!result || busy || manual) return
    setEditMode(mode)
    setReviewingChanges(false)
    setEvents(editable(mode === 'failed' ? [] : result.events))
    setError('')
    setNotice('')
  }
  const cancelEdit = () => {
    if (result && !busy) {
      showResult(result)
      setError('')
      setNotice('저장하지 않은 수정을 취소했어요.')
    }
  }
  const scrollToTop = () => window.setTimeout(() => topRef.current?.focus(), 0)
  const leaveReviewMessage = (action: string) =>
    result
      ? `저장하지 않은 수정은 사라져요. ${action} 저장된 원문은 지난 기록에 남아요.`
      : request.current.id
        ? `이 메모의 저장 여부를 확인하지 못했어요. 현재 입력을 닫고 ${action}`
        : `저장하지 않은 관찰 메모가 사라져요. ${action}`
  const clearRecord = (
    destination: 'write' | 'history' = 'write',
    returnToPrint: false | 'now' | 'after-feedback' = false,
  ) => {
    const returnHref = returnToPrint && activeRef.current ? reviewReturnHref.current : null
    reviewReturnHref.current = null
    feedbackReturnHref.current = null
    autoRecordDate.current = true
    selectedMemoId.current = null
    setView(destination)
    setReviewOrigin('compose')
    reviewOriginRef.current = 'compose'
    setDateChosen(false)
    setEditMode(null)
    setReviewingChanges(false)
    replaceMemoHash(null, destination)
    setText('')
    setRecordDate(localToday())
    setResult(null)
    setReviewOpen(false)
    setEvents([])
    setManual(null)
    setEditingEvent(null)
    setEditingError('')
    setSourceDraft(null)
    setSourceError('')
    sourceRequest.current = { signature: '', id: '' }
    setError('')
    setNotice('')
    request.current = { signature: '', id: '' }
    if (returnHref) {
      if (returnToPrint === 'after-feedback') feedbackReturnHref.current = returnHref
      else replaceRouteHash(returnHref)
    } else if (destination === 'write') scrollToTop()
  }
  const closeReview = async (destination = view, fromNavigation = false) => {
    // New-memo processing can be tucked away while it finishes in the background.
    if (reviewOrigin === 'compose' && busy !== 'update') {
      setReviewOpen(false)
      return
    }
    const restoreLocation = () => {
      const oldURL = location.href
      window.history.replaceState(null, '', reviewLocation.current)
      window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: location.href }))
    }
    if (requestBusy.current || transitionBusy.current) {
      if (fromNavigation) restoreLocation()
      return
    }
    const changed = Boolean(
      editingEvent ||
      sourceDraft !== null ||
      manual ||
      (result &&
        JSON.stringify(events.map(apiEvent)) !==
          JSON.stringify(occurred(result.events).map(apiEvent))),
    )
    if (changed) {
      if (fromNavigation) restoreLocation()
      transitionBusy.current = true
      try {
        const accepted = await ask({
          title: '수정을 그만할까요?',
          message: '저장하지 않은 수정은 사라져요. 기존 메모는 그대로 남아요.',
          confirmLabel: '수정 그만하기',
          tone: 'danger',
        })
        if (!accepted || !activeRef.current) return
      } finally {
        transitionBusy.current = false
      }
    }
    clearRecord(destination, fromNavigation ? false : 'now')
  }
  returnFromSavedReview.current = (destination) => void closeReview(destination, true)
  const reset = async () => {
    if (requestBusy.current || transitionBusy.current || !activeRef.current) return
    const version = navigationVersion.current
    transitionBusy.current = true
    try {
      if (
        reviewDirty &&
        !(await ask({
          title: '새 메모를 작성할까요?',
          message: leaveReviewMessage('새 메모를 작성할까요?'),
          confirmLabel: '새 메모 쓰기',
          tone: 'danger',
        }))
      )
        return
      if (activeRef.current && version === navigationVersion.current) clearRecord()
    } finally {
      transitionBusy.current = false
    }
  }
  const create = async (event: FormEvent) => {
    event.preventDefault()
    if (requestBusy.current || transitionBusy.current) return
    if (!text.trim()) {
      setError('관찰한 내용을 먼저 적어 주세요.')
      return
    }
    if (!recordDate || recordDate > localToday()) {
      setError('기록 날짜는 오늘 또는 지난 날짜로 골라 주세요.')
      return
    }
    const signature = JSON.stringify([text, recordDate])
    if (request.current.signature !== signature)
      request.current = { signature, id: crypto.randomUUID() }
    requestBusy.current = true
    setBusy('create')
    setReviewOpen(true)
    setError('')
    setNotice('')
    try {
      acceptSavedMemo(
        await api.createMemo({ text, record_date: recordDate, request_id: request.current.id }),
        true,
        'compose',
      )
      updated()
      scrollToTop()
    } catch (err) {
      setReviewOpen(false)
      setError(`저장 여부를 확인하지 못했어요. 입력한 내용은 남아 있어요. ${messageOf(err)}`)
    } finally {
      requestBusy.current = false
      setBusy(null)
    }
  }
  const retry = async () => {
    if (!result || requestBusy.current || transitionBusy.current) return
    requestBusy.current = true
    setBusy('retry')
    setError('')
    try {
      acceptSavedMemo(await api.retryMemo(result.memo_id))
      updated()
    } catch (err) {
      setError(
        `${messageOf(err)} 지난 기록 찾기에서 이 메모를 다시 열어 저장된 상태를 확인해 주세요.`,
      )
    } finally {
      requestBusy.current = false
      setBusy(null)
    }
  }
  const editSource = () => {
    if (!result || requestBusy.current || transitionBusy.current) return
    setSourceDraft(result.text)
    setSourceError('')
    setError('')
  }
  const closeSourceEditor = () => {
    if (requestBusy.current || transitionBusy.current) return
    setSourceDraft(null)
    setSourceError('')
  }
  const saveSource = async (event: FormEvent) => {
    event.preventDefault()
    if (!result || sourceDraft === null || requestBusy.current || transitionBusy.current) return
    if (!sourceDraft.trim()) {
      setSourceError('관찰한 내용을 적어 주세요.')
      return
    }
    if (sourceDraft === result.text) {
      closeSourceEditor()
      return
    }
    const signature = JSON.stringify([result.memo_id, sourceDraft])
    if (sourceRequest.current.signature !== signature)
      sourceRequest.current = { signature, id: crypto.randomUUID() }
    requestBusy.current = true
    setBusy('update')
    setSourceError('')
    try {
      const saved = await api.updateMemo(result.memo_id, {
        text: sourceDraft,
        request_id: sourceRequest.current.id,
      })
      acceptSavedMemo(saved)
      updated()
    } catch (err) {
      setSourceError(`저장 여부를 확인하지 못했어요. 수정한 내용은 남아 있어요. ${messageOf(err)}`)
      // A lost response may still have committed the source change on the server.
      updated()
    } finally {
      requestBusy.current = false
      setBusy(null)
    }
  }
  const saveQuestion = async (event: FormEvent) => {
    event.preventDefault()
    if (requestBusy.current || transitionBusy.current || !questionText.trim()) return
    requestBusy.current = true
    setBusy('question')
    setQuestionError('')
    setQuestionNotice('')
    try {
      const saved = await api.addQuestion({ text: questionText.trim() })
      // A list request started before saving must not hide the newly saved question.
      questionsRequest.current++
      setSavedQuestions((previous) => [saved, ...previous.filter((item) => item.id !== saved.id)])
      setQuestionsOpen(true)
      setQuestionsLoading(false)
      setQuestionsLoadError('')
      setQuestionText('')
      const message = '질문을 저장했어요.'
      if (result) setNotice(message)
      else setQuestionNotice(message)
      updated()
    } catch (err) {
      setQuestionError(messageOf(err))
    } finally {
      requestBusy.current = false
      setBusy(null)
    }
  }
  const validateEvent = (event: EventCard) => {
    if (!event.evidence.trim()) return '원문에서 사건이 나온 구절을 선택해 주세요.'
    if (!text.includes(event.evidence))
      return '근거가 현재 원문과 맞지 않아요. 원문에서 구절을 다시 선택해 주세요.'
    if (
      event.time_expr !== null &&
      (!event.time_expr.trim() || event.time_expr.length > 200 || !text.includes(event.time_expr))
    )
      return '시간 표현은 원문에 있는 말을 그대로 적거나, 비워 주세요.'
    if (!Number.isInteger(event.count) || event.count < 1)
      return '횟수는 1 이상의 정수로 적어 주세요.'
    return ''
  }
  const confirm = async (event: FormEvent) => {
    event.preventDefault()
    if (!result || requestBusy.current || transitionBusy.current) return
    const invalidEvent = events.find((item) => validateEvent(item))
    if (invalidEvent) {
      setEditingEvent({ ...invalidEvent })
      setEditingError(validateEvent(invalidEvent))
      setError('')
      return
    }
    if (events.length > 100) {
      setError('한 메모에는 사건을 100개까지 확인할 수 있어요.')
      return
    }
    if (editMode === 'confirmed' && !reviewingChanges) {
      setReviewingChanges(true)
      setError('')
      return
    }
    requestBusy.current = true
    setBusy('confirm')
    setError('')
    try {
      const confirmed = await api.confirmMemo(result.memo_id, {
        events: events.map((item) =>
          apiEvent(editMode === 'failed' ? { ...item, model_event_index: null } : item),
        ),
        ...(editMode === 'failed' ? { manual: true } : {}),
      })
      acceptSavedMemo(confirmed, false)
      clearRecord(reviewOrigin === 'saved' ? view : 'write', 'after-feedback')
      setNotice(
        editMode === 'confirmed'
          ? '수정 내용을 다시 확정했어요.'
          : events.length
            ? `${events.length}건의 기록을 저장했어요.`
            : '원문 메모를 저장했어요.',
      )
      updated()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      requestBusy.current = false
      setBusy(null)
    }
  }
  const addManual = async (event: FormEvent) => {
    event.preventDefault()
    if (!manual || !result || requestBusy.current || transitionBusy.current) return
    const invalid = validateEvent(manual)
    if (invalid) {
      setManualError(invalid)
      return
    }
    const sameEvent = (item: EventCard) =>
      item.type === manual.type &&
      item.status === manual.status &&
      item.time_expr === manual.time_expr &&
      item.count === manual.count &&
      item.evidence === manual.evidence
    if (events.some(sameEvent)) {
      setManualError(
        readonly
          ? '같은 사건이 이미 저장되어 있어요.'
          : '같은 사건이 이미 있어요. 횟수를 늘리려면 기존 카드의 횟수를 수정해 주세요.',
      )
      return
    }
    if (!readonly && events.length >= 100) {
      setManualError('한 메모에는 사건을 100개까지 확인할 수 있어요.')
      return
    }
    if (!readonly) {
      setEvents((previous) =>
        previous.some(sameEvent) ? previous : [...previous, ...editable([manual])],
      )
      setManual(null)
      setManualError('')
      return
    }
    requestBusy.current = true
    setBusy('add')
    setManualError('')
    try {
      acceptSavedMemo(await api.addEvent({ memo_id: result.memo_id, ...apiEvent(manual) }))
      setNotice('빠진 사건을 추가했어요.')
      updated()
    } catch (err) {
      setManualError(messageOf(err))
    } finally {
      requestBusy.current = false
      setBusy(null)
    }
  }
  const openMemo = async (memo: MemoResult) => {
    if (requestBusy.current || transitionBusy.current || !activeRef.current) return false
    if (result?.memo_id === memo.memo_id && reviewDirty) {
      const returnHref = linkedMemoId() === memo.memo_id ? printReviewReturnHref() : null
      if (view === 'history' || returnHref) {
        setReviewOrigin('saved')
        reviewOriginRef.current = 'saved'
      }
      reviewReturnHref.current = returnHref
      setReviewOpen(true)
      replaceMemoHash(memo.memo_id)
      reviewLocation.current = location.hash
      return true
    }
    const version = navigationVersion.current
    transitionBusy.current = true
    try {
      // Reopening also recovers server results after a response was lost.
      if (
        reviewDirty &&
        !(await ask({
          title: '다른 기록을 열까요?',
          message: leaveReviewMessage('이 기록을 열까요?'),
          confirmLabel: '기록 열기',
          tone: 'danger',
        }))
      )
        return false
      if (!activeRef.current || version !== navigationVersion.current) return false
      showResult(memo, 'saved')
      setError('')
      setNotice('')
      return true
    } finally {
      transitionBusy.current = false
    }
  }
  const openLinkedMemo = useRef(openMemo)
  openLinkedMemo.current = openMemo
  useEffect(() => {
    if (
      !active ||
      linkTarget.id === null ||
      handledLink.current === linkTarget.request ||
      historyLoading ||
      historyError ||
      busy ||
      confirmationPending
    )
      return
    handledLink.current = linkTarget.request
    const memo = history.find((item) => item.memo_id === linkTarget.id)
    if (!memo) {
      setError('해당 메모를 찾지 못했어요. 지난 기록 찾기에서 저장된 기록을 확인해 주세요.')
      return
    }
    const targetId = linkTarget.id
    void openLinkedMemo.current(memo).then((opened) => {
      if (!opened && activeRef.current && linkedMemoId() === targetId)
        replaceMemoHash(selectedMemoId.current)
    })
  }, [active, linkTarget, history, historyLoading, historyError, busy, confirmationPending])
  const editEvent = (event: EditableEvent) => {
    if (requestBusy.current || transitionBusy.current) return
    setEditingEvent({ ...event })
    setEditingError('')
    setError('')
  }
  const applyEvent = (event: FormEvent) => {
    event.preventDefault()
    if (!editingEvent || requestBusy.current) return
    const invalid = validateEvent(editingEvent)
    if (invalid) {
      setEditingError(invalid)
      return
    }
    setEvents((previous) =>
      previous.map((item) => (item.uiKey === editingEvent.uiKey ? { ...editingEvent } : item)),
    )
    setEditingEvent(null)
    setEditingError('')
  }
  const deleteEvent = async (event: EditableEvent) => {
    if (requestBusy.current || transitionBusy.current || !activeRef.current) return
    transitionBusy.current = true
    try {
      if (
        (await ask({
          title: '이 카드를 삭제할까요?',
          message: `${event.type} 카드를 확인 목록에서 제외해요. 작성한 원문은 그대로 남아요.`,
          confirmLabel: '카드 삭제',
          tone: 'danger',
        })) &&
        activeRef.current
      ) {
        setEvents((previous) => previous.filter((item) => item.uiKey !== event.uiKey))
        setError('')
      }
    } finally {
      transitionBusy.current = false
    }
  }
  const deleteMemo = async (memo: MemoResult) => {
    if (requestBusy.current || transitionBusy.current || !activeRef.current) return
    const version = navigationVersion.current
    transitionBusy.current = true
    try {
      const accepted = await ask({
        title: '이 기록을 삭제할까요?',
        message: `${shortDate(memo.record_date)} 메모와 정리된 내용이 함께 삭제돼요. 경과와 요약지에서도 제외되며, 되돌릴 수 없어요.`,
        confirmLabel: '기록 삭제',
        tone: 'danger',
      })
      if (!accepted || !activeRef.current || version !== navigationVersion.current) return
      requestBusy.current = true
      setBusy('delete')
      setError('')
      setNotice('')
      try {
        await api.deleteMemo(memo.memo_id)
        historyRequest.current += 1
        setHistory((previous) => previous.filter((item) => item.memo_id !== memo.memo_id))
        setHistoryError('')
        setHistoryLoading(false)
        if (selectedMemoId.current === memo.memo_id) {
          clearRecord(reviewOrigin === 'saved' ? view : 'write', 'after-feedback')
        }
        setNotice('기록을 삭제했어요.')
        updated()
      } catch (err) {
        setError(`기록을 삭제하지 못했어요. ${messageOf(err)}`)
      } finally {
        requestBusy.current = false
        setBusy(null)
      }
    } finally {
      transitionBusy.current = false
    }
  }
  const closeFeedback = () => {
    const returnHref = activeRef.current ? feedbackReturnHref.current : null
    feedbackReturnHref.current = null
    setError('')
    setNotice('')
    setQuestionError('')
    setQuestionNotice('')
    if (returnHref) replaceRouteHash(returnHref)
  }
  const filterFrom = range === 'custom' ? from : daysBefore(today, Number(range) - 1)
  const filterTo = range === 'custom' ? to : today
  const invalidRange = Boolean(filterFrom && filterTo && filterFrom > filterTo)
  const dateInFilter = (date: string | null) =>
    !invalidRange &&
    date !== null &&
    (!filterFrom || date >= filterFrom) &&
    (!filterTo || date <= filterTo)
  const filtered = history
    .filter(
      (memo) =>
        dateInFilter(memo.record_date) && (statusFilter === '전체' || memo.status === statusFilter),
    )
    .sort((a, b) => b.record_date.localeCompare(a.record_date) || b.memo_id - a.memo_id)
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10))
  const currentPage = Math.min(historyPage, pageCount)
  const pageMemos = filtered.slice((currentPage - 1) * 10, currentPage * 10)
  const movePage = (next: number) => {
    setHistoryPage(next)
    window.setTimeout(() => historyStart.current?.focus(), 0)
  }
  const selectRange = (next: typeof range) => {
    if (next === 'custom' && !from && !to) {
      setFrom(filterFrom)
      setTo(filterTo)
    }
    setRange(next)
  }
  const formBusy = Boolean(
    busy || confirmationPending || editingEvent || reviewingChanges || sourceDraft !== null,
  )
  const openHistory = () => {
    if (formBusy) return
    void refreshHistory()
    showHistoryHash()
    scrollToTop()
  }
  const historyLoadError = historyError && (
    <div className="mvp-rc-history-error">
      <p className="mvp-rc-error" role="alert">
        기록을 불러오지 못했어요. {historyError}
      </p>
      <button
        type="button"
        className="button outline mvp-rc-history-retry"
        onClick={() => void refreshHistory()}
        disabled={historyLoading || formBusy}
      >
        <RotateCcw size={17} aria-hidden="true" />
        {historyLoading ? '불러오는 중…' : '다시 불러오기'}
      </button>
    </div>
  )
  const pageTitle =
    view === 'history'
      ? '지난 기록 찾기'
      : result && reviewOrigin === 'compose'
        ? readonly
          ? '기록 상세'
          : '확인·수정'
        : reviewOrigin === 'saved' || recordDate === today
          ? '오늘의 기록'
          : '지난날의 기록'

  const recentMemos = [...history]
    .sort((a, b) => b.record_date.localeCompare(a.record_date) || b.memo_id - a.memo_id)
    .slice(0, 3)
  const chooseRecordDate = (date: string) => {
    autoRecordDate.current = false
    setDateChosen(true)
    setRecordDate(date)
    setError('')
  }
  const addMissing = () => {
    if (!result) return
    setManual(newManualEvent())
    setManualError('')
    setError('')
  }
  const showReview =
    active &&
    (view === 'write' || reviewOrigin === 'saved') &&
    reviewOpen &&
    Boolean(result || busy === 'create')
  const recordActions = result && !reviewingChanges && (
    <div className="mvp-rc-confirm">
      <div className="mvp-rc-record-actions" role="group" aria-label="기록 확인 및 삭제">
        <button
          type="button"
          className="button outline mvp-rc-delete-memo"
          onClick={() => deleteMemo(result)}
          disabled={formBusy || Boolean(manual)}
        >
          <Trash2 size={17} aria-hidden="true" />
          {busy === 'delete' ? '삭제 중…' : '기록 삭제'}
        </button>
        {reviewable ? (
          <button
            className="button"
            type="submit"
            aria-describedby="record-confirm-help"
            disabled={formBusy || Boolean(manual)}
          >
            {busy === 'confirm'
              ? '저장 중…'
              : editMode === 'confirmed'
                ? '변경 내용 검토'
                : '확인 완료'}
          </button>
        ) : (
          <button
            className="button"
            type="button"
            disabled={formBusy || Boolean(manual)}
            onClick={() => startEdit(readonly ? 'confirmed' : 'failed')}
          >
            {readonly ? '확정 내용 수정' : '직접 정리'}
          </button>
        )}
      </div>
      {reviewable && <p id="record-confirm-help">확인한 내용만 통계에 들어가요.</p>}
      {editMode && (
        <button className="button outline" type="button" onClick={cancelEdit} disabled={formBusy}>
          수정 취소
        </button>
      )}
    </div>
  )
  const emergencyNotice = (
    <>
      {emergency && (
        <section className="mvp-rc-emergency" role="alert">
          <div>
            <ShieldAlert size={22} />
            <h2>응급 안내</h2>
          </div>
          <p>{result?.emergency.message || health?.emergency_message}</p>
          <div className="mvp-rc-emergency-calls">
            <a className="button" href="tel:119">
              119 전화
            </a>
            <a className="button outline" href="tel:112">
              112 전화
            </a>
            <a className="button outline" href="tel:18999988">
              1899-9988
            </a>
            <a className="button outline" href="tel:109">
              109
            </a>
          </div>
        </section>
      )}
      <p className="mvp-rc-hint mvp-rc-emergency-limit">
        응급 안내가 뜨지 않았다고 괜찮은 상황이라는 뜻은 아니에요.
      </p>
    </>
  )

  return (
    <div className="mvp-rc-page mvp-rc-v2 stack is-composing">
      <header className="mvp-rc-heading" ref={topRef} tabIndex={-1}>
        <div>
          <h1 tabIndex={-1}>{pageTitle}</h1>
          <p>말하듯 적으면 AI가 정리해요.</p>
        </div>
        <button
          className="button outline mvp-rc-history-link"
          type="button"
          aria-controls={view === 'write' ? 'record-history' : 'record-writing'}
          disabled={formBusy}
          onClick={() => {
            if (view === 'write') openHistory()
            else {
              setView('write')
              replaceMemoHash(selectedMemoId.current, 'write')
            }
          }}
        >
          {view === 'write' ? (
            <>
              <Search size={18} aria-hidden="true" />
              지난 기록 찾기
            </>
          ) : (
            <>
              <ChevronLeft size={18} aria-hidden="true" />
              기록하기
            </>
          )}
        </button>
      </header>
      <section
        id="record-writing"
        className="mvp-rc-writing"
        aria-label="관찰 메모 작성과 확인"
        hidden={view !== 'write'}
      >
        <div className="mvp-rc-input-column stack">
          <form className="card stack mvp-rc-editor" onSubmit={create}>
            <fieldset className="mvp-rc-fields" disabled={formBusy || Boolean(result)}>
              <div className="mvp-rc-editor-heading">
                <label htmlFor="record-text">관찰 메모</label>
                <div className="mvp-rc-date-field">
                  <label htmlFor="record-date" className="mvp-rc-sr-only">
                    기록 날짜
                  </label>
                  <span className="mvp-rc-date-controls">
                    <input
                      id="record-date"
                      type="date"
                      className="itda-date-input"
                      required
                      max={today}
                      value={reviewOrigin === 'saved' ? today : recordDate}
                      onChange={(e) => chooseRecordDate(e.target.value)}
                    />
                  </span>
                </div>
              </div>
              <textarea
                id="record-text"
                aria-label="어떤 일이 있었나요?"
                rows={5}
                value={reviewOrigin === 'saved' ? '' : text}
                maxLength={10000}
                required
                placeholder="새벽 3시쯤 깨서 현관문 열려고 하심."
                onChange={(e) => {
                  autoRecordDate.current = false
                  setText(e.target.value)
                  setError('')
                }}
              />
            </fieldset>
            {result && reviewOrigin === 'compose' ? (
              <div className="mvp-rc-result-actions stack">
                <button
                  className="button wide"
                  type="button"
                  disabled={formBusy}
                  onClick={() => setReviewOpen(true)}
                >
                  <FileText size={18} />
                  정리된 내용 보기
                </button>
                <button
                  className="button outline wide"
                  type="button"
                  disabled={formBusy}
                  onClick={reset}
                >
                  <Plus size={18} />새 메모 쓰기
                </button>
              </div>
            ) : (
              <button className="button wide" type="submit" disabled={formBusy || !text.trim()}>
                {busy === 'create' ? (
                  <>
                    <LoaderCircle size={19} className="mvp-rc-spin" />
                    정리하고 있어요
                  </>
                ) : (
                  '저장하고 정리하기'
                )}
              </button>
            )}
            {busy === 'create' && !reviewOpen && (
              <button
                className="button outline wide"
                type="button"
                onClick={() => setReviewOpen(true)}
              >
                정리 상태 보기
              </button>
            )}
          </form>
          {!showReview && emergencyNotice}
          <section className="card mvp-rc-question-card" aria-labelledby="record-question-heading">
            <div className="mvp-rc-row">
              <h2 id="record-question-heading">의사에게 물어볼 것</h2>
            </div>
            <form className="mvp-rc-question-form" onSubmit={saveQuestion}>
              <label htmlFor="record-question">
                <span className="mvp-rc-sr-only">질문 메모</span>
                <textarea
                  id="record-question"
                  rows={1}
                  maxLength={1000}
                  placeholder="다음 진료 때 묻고 싶은 것"
                  value={questionText}
                  disabled={formBusy}
                  onChange={(event) => {
                    setQuestionText(event.target.value)
                    setQuestionError('')
                    setQuestionNotice('')
                  }}
                />
              </label>
              <button
                className="button accent"
                type="submit"
                disabled={formBusy || !questionText.trim()}
              >
                {busy === 'question' ? '저장 중…' : '질문 저장'}
              </button>
            </form>
            {(savedQuestions.length > 0 || questionsLoading || questionsLoadError) && (
              <details
                className="mvp-rc-saved-questions"
                open={questionsOpen}
                onToggle={(event) => setQuestionsOpen(event.currentTarget.open)}
              >
                <summary>
                  <h3>최근 질문</h3>
                  <ChevronDown size={18} aria-hidden="true" />
                </summary>
                {questionsLoading && !savedQuestions.length && (
                  <p className="mvp-rc-hint" role="status">
                    질문을 불러오고 있어요.
                  </p>
                )}
                {questionsLoadError && (
                  <div className="mvp-rc-questions-error">
                    <p>{questionsLoadError}</p>
                    <button
                      type="button"
                      className="button outline"
                      disabled={questionsLoading || formBusy}
                      onClick={() => void refreshQuestions()}
                    >
                      <RotateCcw size={16} aria-hidden="true" />
                      질문 다시 불러오기
                    </button>
                  </div>
                )}
                {savedQuestions.length > 0 && (
                  <ul aria-label="최근 질문 목록">
                    {[...savedQuestions]
                      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
                      .slice(0, 3)
                      .map((question) => (
                        <li key={question.id}>
                          <time dateTime={question.created_at}>
                            {shortDate(question.created_at.slice(0, 10))}
                          </time>
                          <p>{question.text}</p>
                        </li>
                      ))}
                  </ul>
                )}
              </details>
            )}
          </section>
          <section className="card mvp-rc-recent" aria-labelledby="record-recent-heading">
            <div className="mvp-rc-row">
              <h2 id="record-recent-heading">최근 기록</h2>
              <button
                type="button"
                className="button outline mvp-rc-recent-more"
                onClick={openHistory}
                aria-controls="record-history"
                disabled={formBusy}
              >
                더 보기
                <ChevronRight size={17} aria-hidden="true" />
              </button>
            </div>
            {historyLoadError}
            {historyLoading && !history.length && <p role="status">기록을 불러오고 있어요.</p>}
            {!historyLoading && !historyError && !recentMemos.length && (
              <p className="mvp-rc-hint">첫 메모를 남기면 여기에서 다시 볼 수 있어요.</p>
            )}
            <ul>
              {recentMemos.map((memo) => (
                <li key={memo.memo_id}>
                  <button
                    type="button"
                    disabled={formBusy}
                    aria-current={result?.memo_id === memo.memo_id ? 'true' : undefined}
                    onClick={() => openMemo(memo)}
                  >
                    <time dateTime={memo.record_date}>{shortDate(memo.record_date)}</time>
                    <span>{memo.text}</span>
                    <span
                      className={`mvp-rc-status ${memo.status === '확인 완료' ? 'is-confirmed' : memo.status === '정리 실패' ? 'is-failed' : 'is-pending'}`}
                    >
                      {memo.status}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          {!result && health && health.ai_available === false && (
            <p className="mvp-rc-hint">
              AI 정리가 연결되지 않았어요. 저장한 메모는 직접 정리할 수 있어요.
            </p>
          )}
        </div>
      </section>
      <Modal
        open={showReview}
        title="정리된 내용"
        size="wide"
        busy={
          busy === 'confirm' ||
          busy === 'add' ||
          busy === 'retry' ||
          busy === 'delete' ||
          busy === 'update'
        }
        onClose={() => void closeReview()}
      >
        <div className="mvp-rc-page mvp-rc-v2 mvp-rc-review-dialog">
          <section className="mvp-rc-confirm-column stack" aria-label="메모 정리 결과">
            {emergencyNotice}
            {(busy === 'create' || busy === 'retry') && (
              <div className="mvp-rc-loading" role="status" aria-live="polite">
                <LoaderCircle className="mvp-rc-spin" size={24} />
                <div>
                  <strong>정리하고 있어요</strong>
                  <p>작성한 메모는 그대로 보관해요.</p>
                </div>
              </div>
            )}
            {result && (
              <section className="card mvp-rc-original stack">
                <div className="mvp-rc-row">
                  <h2>작성한 메모</h2>
                  <time dateTime={result.record_date}>{shortDate(result.record_date)}</time>
                </div>
                <p>{result.text}</p>
                <div className="mvp-rc-source-actions">
                  <button
                    type="button"
                    className="button outline"
                    onClick={editSource}
                    disabled={formBusy || Boolean(manual)}
                  >
                    <Pencil size={17} aria-hidden="true" />
                    메모 수정
                  </button>
                </div>
              </section>
            )}
            {result?.status === '정리 실패' && !editMode && (
              <section className="card mvp-rc-failure stack">
                <h2>정리하지 못했어요</h2>
                <p>{failureMessage}</p>
                <p className="mvp-rc-hint">
                  원문은 저장되어 있어요. 직접 정리해서 확인을 마칠 수 있어요.
                </p>
                {failureCode === 'connection_error' && (
                  <p className="mvp-rc-hint">AI 정리 프로그램이 연결되면 다시 시도해 주세요.</p>
                )}
                {failureCode === 'model_not_found' && (
                  <p className="mvp-rc-hint">AI 재시도는 모델이 준비된 뒤에 할 수 있어요.</p>
                )}
                <div className="mvp-rc-failure-actions">
                  <button
                    type="button"
                    className="button outline"
                    onClick={retry}
                    disabled={formBusy}
                  >
                    <RotateCcw size={18} />
                    다시 시도
                  </button>
                </div>
              </section>
            )}
            {reviewable && !reviewingChanges && (
              <section className="mvp-rc-review-group stack">
                <div className="mvp-rc-review-heading">
                  <div className="mvp-rc-row">
                    <h2>
                      {editMode === 'confirmed'
                        ? '확정 내용 수정'
                        : editMode === 'failed'
                          ? '직접 정리한 내용 확인'
                          : `정리된 내용 ${events.length}건`}
                    </h2>
                    <span className="mvp-rc-status is-pending">확인 대기</span>
                  </div>
                  <p className="mvp-rc-ai-notice">
                    {editMode === 'failed'
                      ? '원문에서 사건을 골라 직접 정리해 주세요.'
                      : editMode === 'confirmed'
                        ? '확정한 내용이에요. 바꿀 부분을 수정해 주세요.'
                        : health?.ai_notice || 'AI가 정리한 내용이에요. 틀린 부분은 고쳐 주세요.'}
                  </p>
                </div>
                <form className="stack" onSubmit={confirm} noValidate>
                  <div className="mvp-rc-event-grid">
                    {events.map((event, index) => (
                      <ReviewCard
                        key={event.uiKey}
                        event={event}
                        number={index + 1}
                        text={text}
                        disabled={formBusy}
                        onEdit={() => editEvent(event)}
                        onDelete={() => {
                          void deleteEvent(event)
                        }}
                      />
                    ))}
                    {!events.length && (
                      <div className="card mvp-rc-empty">
                        <FileText size={28} />
                        <h3>정리된 사건이 없어요</h3>
                        <p>원문만 확인 완료로 저장하거나 빠진 사건을 추가해 주세요.</p>
                      </div>
                    )}
                    {!manual && (
                      <button
                        type="button"
                        className="mvp-rc-add-card"
                        disabled={formBusy}
                        onClick={addMissing}
                      >
                        <Plus size={22} />
                        <span>빠진 사건 추가</span>
                      </button>
                    )}
                  </div>
                  {recordActions}
                </form>
              </section>
            )}
            {readonly && (
              <section className="stack" aria-label="확인 완료한 사건">
                <div className="mvp-rc-review-heading">
                  <h2>확인 완료한 내용</h2>
                  <p>
                    {events.length
                      ? `${events.length}개 사건을 확인했어요.`
                      : '원문만 확인 완료로 저장했어요.'}
                  </p>
                </div>
                <div className="mvp-rc-event-grid">
                  {events.map((event) => (
                    <article className="card mvp-rc-approved" key={event.uiKey}>
                      <div className="mvp-rc-row">
                        <h3>{event.type}</h3>
                      </div>
                      <p>
                        {event.time_expr || '시간 표현 없음'}
                        {` · ${event.count}회`}
                      </p>
                      <q className="mvp-rc-event-quote" aria-label="근거 원문">
                        <EvidenceExcerpt text={text} evidence={event.evidence} />
                      </q>
                    </article>
                  ))}
                  {!manual && (
                    <button
                      type="button"
                      className="mvp-rc-add-card"
                      disabled={formBusy}
                      onClick={addMissing}
                    >
                      <Plus size={22} />
                      <span>빠진 사건 추가</span>
                    </button>
                  )}
                </div>
              </section>
            )}
            {!reviewable && recordActions}
          </section>
        </div>
      </Modal>
      {active && (
        <>
          {confirmationDialog}
          <Modal
            open={sourceDraft !== null}
            title="메모 수정"
            onClose={closeSourceEditor}
            busy={busy === 'update'}
            footer={
              <>
                <button
                  className="button outline mvp-rc-source-cancel"
                  type="button"
                  disabled={busy === 'update'}
                  onClick={closeSourceEditor}
                >
                  취소
                </button>
                <button
                  className="button mvp-rc-source-save"
                  type="submit"
                  form="record-source-edit"
                  disabled={busy === 'update' || sourceDraft === result?.text}
                >
                  {busy === 'update' ? '다시 정리하고 있어요' : '저장하고 다시 정리'}
                </button>
              </>
            }
          >
            <form
              id="record-source-edit"
              className="stack mvp-rc-source-editor"
              onSubmit={saveSource}
              noValidate
            >
              <p>이전 카드는 새로 정리돼요. 다시 확인한 내용만 경과와 요약지에 반영돼요.</p>
              <label htmlFor="record-source-text">관찰 메모</label>
              <textarea
                id="record-source-text"
                rows={6}
                value={sourceDraft ?? ''}
                maxLength={10000}
                required
                disabled={busy === 'update'}
                onChange={(event) => {
                  setSourceDraft(event.target.value)
                  setSourceError('')
                }}
              />
              {sourceError && (
                <p className="mvp-rc-error" role="alert">
                  {sourceError}
                </p>
              )}
              {busy === 'update' && (
                <p role="status">수정한 메모를 저장하고 다시 정리하고 있어요.</p>
              )}
            </form>
          </Modal>
          <Modal
            open={Boolean(editingEvent)}
            title="내용 수정"
            onClose={() => {
              setEditingEvent(null)
              setEditingError('')
            }}
          >
            {editingEvent && (
              <form className="stack mvp-rc-edit-dialog" onSubmit={applyEvent} noValidate>
                <p className="mvp-rc-hint">수정 적용을 누르면 카드에 반영돼요.</p>
                <EventFields
                  event={editingEvent}
                  index="edit-record-event"
                  text={text}
                  onChange={(next) => {
                    setEditingEvent({ ...next, uiKey: editingEvent.uiKey })
                    setEditingError('')
                  }}
                />
                {editingError && (
                  <p className="mvp-rc-error" role="alert">
                    {editingError}
                  </p>
                )}
                <div className="mvp-rc-actions">
                  <button
                    type="button"
                    className="button outline"
                    onClick={() => {
                      setEditingEvent(null)
                      setEditingError('')
                    }}
                  >
                    취소
                  </button>
                  <button type="submit" className="button">
                    수정 적용
                  </button>
                </div>
              </form>
            )}
          </Modal>
          <Modal
            open={Boolean(manual)}
            title="빠진 사건 추가"
            onClose={() => {
              setManual(null)
              setManualError('')
            }}
            busy={Boolean(busy)}
          >
            {manual && (
              <form className="stack mvp-rc-manual" onSubmit={addManual} noValidate>
                {readonly && <p className="mvp-rc-hint">추가한 내용은 확인 완료로 저장돼요.</p>}
                <EventFields
                  event={manual}
                  index="manual-event"
                  text={text}
                  disabled={Boolean(busy)}
                  onChange={(next) => {
                    setManual(next)
                    setManualError('')
                  }}
                />
                {manualError && (
                  <p className="mvp-rc-error" role="alert">
                    {manualError}
                  </p>
                )}
                <div className="mvp-rc-actions">
                  <button
                    type="button"
                    className="button outline"
                    disabled={Boolean(busy)}
                    onClick={() => {
                      setManual(null)
                      setManualError('')
                    }}
                  >
                    취소
                  </button>
                  <button className="button" type="submit" disabled={Boolean(busy)}>
                    {busy === 'add' ? '추가하고 있어요' : '사건 추가'}
                  </button>
                </div>
              </form>
            )}
          </Modal>
          <Modal
            open={Boolean(result && reviewingChanges)}
            title="변경 내용 검토"
            onClose={() => setReviewingChanges(false)}
            busy={Boolean(busy)}
          >
            {result && reviewingChanges && (
              <form className="stack mvp-rc-change-review" onSubmit={confirm}>
                <div className="mvp-rc-comparison">
                  <section>
                    <h3>수정 전</h3>
                    <EventSnapshot events={result.events} />
                  </section>
                  <section>
                    <h3>수정 후</h3>
                    <EventSnapshot events={events} />
                  </section>
                </div>
                <p>다시 확정하면 경과와 요약지가 갱신돼요. 원문과 변경 이력은 남아요.</p>
                <div className="mvp-rc-actions">
                  <button
                    className="button outline"
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => setReviewingChanges(false)}
                  >
                    계속 수정
                  </button>
                  <button className="button" type="submit" disabled={Boolean(busy)}>
                    {busy ? '저장하고 있어요' : '다시 확정'}
                  </button>
                </div>
              </form>
            )}
          </Modal>
          <FeedbackDialog
            message={error || questionError || notice || questionNotice}
            tone={error || questionError ? 'error' : 'success'}
            onClose={closeFeedback}
          />
        </>
      )}
      <aside
        id="record-history"
        className="mvp-rc-history card stack"
        aria-labelledby="record-history-heading"
        hidden={view !== 'history'}
      >
        <div className="mvp-rc-row">
          <h2 id="record-history-heading">최근 기록</h2>
        </div>
        <div className="mvp-rc-history-filters">
          <div className="mvp-rc-range-options" role="group" aria-label="찾을 기간">
            {(['7', '30', 'custom'] as const).map((option) => (
              <button
                type="button"
                className="button outline"
                key={option}
                aria-pressed={range === option}
                onClick={() => selectRange(option)}
              >
                {option === 'custom' ? '직접 선택' : `최근 ${option}일`}
              </button>
            ))}
          </div>
          {range === 'custom' && (
            <div className="mvp-rc-custom-period">
              <div className="mvp-rc-field-grid">
                <label htmlFor="record-filter-from">
                  시작일
                  <input
                    id="record-filter-from"
                    type="date"
                    className="itda-date-input"
                    value={from}
                    max={to || today}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </label>
                <label htmlFor="record-filter-to">
                  종료일
                  <input
                    id="record-filter-to"
                    type="date"
                    className="itda-date-input"
                    value={to}
                    min={from}
                    max={today}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </label>
              </div>
              <button
                type="button"
                className="button outline mvp-rc-reset-period"
                onClick={() => {
                  setFrom('')
                  setTo('')
                  setRange('30')
                }}
              >
                <RotateCcw size={17} aria-hidden="true" />
                기간 초기화
              </button>
            </div>
          )}
          <label htmlFor="record-filter-status">
            확인 상태
            <select
              id="record-filter-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option>전체</option>
              <option>확인 대기</option>
              <option>확인 완료</option>
              <option>정리 실패</option>
            </select>
          </label>
          <p className="mvp-rc-hint">기록 날짜로 찾아요.</p>
          {invalidRange && (
            <p className="mvp-rc-error" role="alert">
              시작일이 종료일보다 늦어요. 기간을 다시 골라 주세요.
            </p>
          )}
        </div>
        {historyLoadError}
        {historyLoading && !history.length && (
          <p className="mvp-rc-hint" role="status">
            기록을 불러오고 있어요.
          </p>
        )}
        {!historyLoading && !historyError && !invalidRange && (
          <p className="mvp-rc-list-count" tabIndex={-1} ref={historyStart} aria-live="polite">
            {filtered.length
              ? `${filtered.length}개 기록 · ${currentPage} / ${pageCount}페이지`
              : '조건에 맞는 기록이 없어요.'}
          </p>
        )}
        {pageCount > 1 && (
          <nav
            className="mvp-rc-pagination mvp-rc-pagination-top"
            aria-label="기록 목록 위쪽 페이지"
          >
            <button
              type="button"
              className="button outline"
              aria-label="이전 페이지"
              disabled={currentPage === 1}
              onClick={() => movePage(currentPage - 1)}
            >
              <ChevronLeft size={18} />
              이전
            </button>
            <button
              type="button"
              className="button outline"
              aria-label="다음 페이지"
              disabled={currentPage === pageCount}
              onClick={() => movePage(currentPage + 1)}
            >
              다음
              <ChevronRight size={18} />
            </button>
          </nav>
        )}
        {!historyLoading && !historyError && !filtered.length && !invalidRange && (
          <div className="mvp-rc-empty">
            <FileText size={28} />
            <p>
              {history.length
                ? '기간이나 확인 상태를 바꿔 찾아보세요.'
                : '첫 메모를 남기면 이곳에서 다시 볼 수 있어요.'}
            </p>
          </div>
        )}
        <ul id="record-history-list" className="mvp-rc-history-list">
          {pageMemos.map((memo) => {
            return (
              <li key={memo.memo_id}>
                <button
                  type="button"
                  className="mvp-rc-history-open"
                  aria-current={result?.memo_id === memo.memo_id ? 'true' : undefined}
                  disabled={formBusy}
                  onClick={() => openMemo(memo)}
                >
                  <div className="mvp-rc-row">
                    <time dateTime={memo.record_date}>{formatDate(memo.record_date)}</time>
                    <ChevronRight size={18} />
                  </div>
                  <p>{memo.text}</p>
                  <span
                    className={`mvp-rc-status ${memo.status === '확인 완료' ? 'is-confirmed' : ''}`}
                  >
                    {memo.status}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        {pageCount > 1 && (
          <nav className="mvp-rc-pagination" aria-label="기록 목록 페이지">
            <button
              type="button"
              className="button outline"
              disabled={currentPage === 1}
              onClick={() => movePage(currentPage - 1)}
            >
              <ChevronLeft size={18} />
              이전
            </button>
            <span>
              {currentPage} / {pageCount}
            </span>
            <button
              type="button"
              className="button outline"
              disabled={currentPage === pageCount}
              onClick={() => movePage(currentPage + 1)}
            >
              다음
              <ChevronRight size={18} />
            </button>
          </nav>
        )}
      </aside>
    </div>
  )
}

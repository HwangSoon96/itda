import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { CalendarDays } from 'lucide-react'
import { api } from '../../api'
import { FeedbackDialog, Modal } from '../../shared/ui'
import { localToday } from '../../shared/lib/date'
import { MEDICATION_CHANGE_LABELS, medicationChangeLabel } from '../../shared/lib/medication'
import type { Medication, Period, Question, Visit } from '../../api/types'
import { useReportSelection } from '../../shared/lib/reportSelection'
import { formatVisitDate as formatDate, VisitHistory } from './VisitHistory'
import { MedicationHistory } from './MedicationHistory'
import { QuestionHistory } from './QuestionHistory'
import '../../shared/styles/record-schedule.css'
import './schedule-clarity.css'
import './schedule.css'

type ItemKind = 'questions' | 'visits' | 'medications'
type DeleteItem = {
  tab: ItemKind
  id: number
  label: string
  detail?: string
  status?: Visit['status']
}
type Feedback = {
  title: string
  message: string
  tone: 'success' | 'error' | 'info'
  retry?: ItemKind | 'load'
  focusMedicationId?: number
  focusQuestionId?: number
}
const tabs: { id: ItemKind; label: string }[] = [
  { id: 'visits', label: '진료일' },
  { id: 'medications', label: '약 변경' },
  { id: 'questions', label: '질문 메모' },
]
const errorText = (err: unknown) =>
  err instanceof Error ? err.message : '연결을 확인하고 다시 시도해 주세요.'
const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()

export function SchedulePage({ active = true }: { active?: boolean }) {
  const { asOf, periodStart } = useReportSelection()
  const [tab, setTab] = useState<ItemKind>('visits')
  const [visits, setVisits] = useState<Visit[]>([])
  const [medications, setMedications] = useState<Medication[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [questionsReady, setQuestionsReady] = useState(false)
  const [visitsReady, setVisitsReady] = useState(false)
  const [medicationsReady, setMedicationsReady] = useState(false)
  const [visitDate, setVisitDate] = useState('')
  const [visitStatus, setVisitStatus] = useState<Visit['status']>('완료')
  const [desktop, setDesktop] = useState(() =>
    window.matchMedia
      ? window.matchMedia('(min-width: 1024px)').matches
      : window.innerWidth >= 1024,
  )
  const [summaryPeriod, setSummaryPeriod] = useState<Period | null>(null)
  const [pendingVisit, setPendingVisit] = useState<Visit | null>(null)
  const [managedVisitId, setManagedVisitId] = useState<number | null>(null)
  const [managedMedicationId, setManagedMedicationId] = useState<number | null>(null)
  const [medicationRevealId, setMedicationRevealId] = useState<number | null>(null)
  const [managedQuestionId, setManagedQuestionId] = useState<number | null>(null)
  const [questionRevealId, setQuestionRevealId] = useState<number | null>(null)
  const [medicationDate, setMedicationDate] = useState('')
  const [medicationName, setMedicationName] = useState('')
  const [changeType, setChangeType] = useState<Medication['change_type'] | ''>('')
  const [questionText, setQuestionText] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [dialogError, setDialogError] = useState('')
  const [busy, setBusy] = useState(false)
  const [savingKind, setSavingKind] = useState<ItemKind | null>(null)
  const [pendingDelete, setPendingDelete] = useState<DeleteItem | null>(null)
  const busyRef = useRef(false)
  const refreshRequest = useRef(0)
  const activeRef = useRef(active)
  activeRef.current = active
  const showFeedback = useCallback((next: Feedback) => setFeedback(next), [])
  useEffect(() => {
    if (!window.matchMedia) return
    const media = window.matchMedia('(min-width: 1024px)')
    const update = () => setDesktop(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  const dirty = Boolean(
    visitDate ||
    medicationDate ||
    medicationName.trim() ||
    changeType ||
    questionText.trim() ||
    busy,
  )
  const refresh = useCallback(async () => {
    const id = ++refreshRequest.current
    setLoading(true)
    setLoadError('')
    setQuestionsReady(false)
    setVisitsReady(false)
    setMedicationsReady(false)
    setSummaryPeriod(null)
    const responses = await Promise.allSettled([
      api.visits(),
      api.medications(),
      api.questions(),
      api.summary(asOf, periodStart, false),
    ])
    if (id !== refreshRequest.current) return
    if (responses[0].status === 'fulfilled') {
      setVisits(responses[0].value)
      setVisitsReady(true)
    }
    if (responses[1].status === 'fulfilled') {
      setMedications(responses[1].value)
      setMedicationsReady(true)
    }
    if (responses[2].status === 'fulfilled') {
      setQuestions(responses[2].value)
      setQuestionsReady(true)
    }
    if (responses[3].status === 'fulfilled') setSummaryPeriod(responses[3].value.period)
    const failed = responses.slice(0, 3).find((response) => response.status === 'rejected')
    if (failed?.status === 'rejected') {
      const message = errorText(failed.reason)
      setLoadError(message)
      if (activeRef.current)
        setFeedback((previous) =>
          previous?.tone === 'success'
            ? previous
            : { title: '기록을 불러오지 못했어요', message, tone: 'error', retry: 'load' },
        )
    }
    setLoading(false)
  }, [asOf, periodStart, showFeedback])
  useEffect(() => {
    void refresh()
    window.addEventListener('itda-final-updated', refresh)
    return () => {
      refreshRequest.current++
      window.removeEventListener('itda-final-updated', refresh)
    }
  }, [refresh])
  useEffect(() => {
    setFeedback(null)
  }, [asOf, periodStart])
  useEffect(() => {
    if (!active) {
      setFeedback(null)
      if (!busyRef.current) {
        setPendingDelete(null)
        setPendingVisit(null)
        setManagedVisitId(null)
        setManagedMedicationId(null)
        setMedicationRevealId(null)
        setManagedQuestionId(null)
        setQuestionRevealId(null)
        setDialogError('')
      }
    } else if (loadError)
      setFeedback(
        (previous) =>
          previous ?? {
            title: '기록을 불러오지 못했어요',
            message: loadError,
            tone: 'error',
            retry: 'load',
          },
      )
  }, [active])
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('itda-final-dirty', { detail: { key: 'schedule', dirty } }),
    )
    return () => {
      window.dispatchEvent(
        new CustomEvent('itda-final-dirty', { detail: { key: 'schedule', dirty: false } }),
      )
    }
  }, [dirty])
  const publish = () => window.dispatchEvent(new Event('itda-final-updated'))
  const selectTab = (next: ItemKind) => {
    setMedicationRevealId(null)
    setQuestionRevealId(null)
    setTab(next)
  }
  const keyboardTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    event.preventDefault()
    selectTab(tabs[next].id)
    document.getElementById(`schedule-tab-${tabs[next].id}`)?.focus()
  }
  useEffect(() => {
    const openLinkedQuestions = () => {
      const query = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
      if (
        !activeRef.current ||
        window.location.hash.split('?')[0] !== '#schedule' ||
        query.get('tab') !== 'questions'
      )
        return
      setTab('questions')
      document
        .getElementById(desktop ? 'schedule-question-text' : 'schedule-tab-questions')
        ?.focus()
    }
    openLinkedQuestions()
    window.addEventListener('hashchange', openLinkedQuestions)
    return () => window.removeEventListener('hashchange', openLinkedQuestions)
  }, [desktop, active])
  const save = async (kind: ItemKind) => {
    if (
      !activeRef.current ||
      busyRef.current ||
      loading ||
      !(kind === 'visits'
        ? visitsReady
        : kind === 'medications'
          ? medicationsReady
          : questionsReady)
    )
      return
    setFeedback(null)
    const invalid = (message: string) =>
      showFeedback({ title: '입력을 확인해 주세요', message, tone: 'error' })
    if (kind === 'visits') {
      if (!visitDate || visits.some((item) => item.visit_date === visitDate)) {
        invalid(visitDate ? '이미 등록된 진료일이에요.' : '진료 날짜를 골라 주세요.')
        return
      }
      if (visitStatus === '완료' && visitDate > localToday()) {
        invalid('앞으로 받을 진료는 ‘다음 예약’을 선택해 주세요.')
        return
      }
      if (visitStatus === '예정' && visitDate < localToday()) {
        invalid('다음 예약일은 오늘 또는 앞으로의 날짜를 선택해 주세요.')
        return
      }
    } else if (kind === 'medications') {
      if (!medicationName.trim() || !medicationDate) {
        invalid('약 이름과 변경 날짜를 모두 적어 주세요.')
        return
      }
      if (!changeType) {
        invalid('약이 어떻게 바뀌었는지 선택해 주세요.')
        return
      }
      if (medicationDate > localToday()) {
        invalid('약을 바꾼 날짜는 오늘 또는 지난 날짜로 골라 주세요.')
        return
      }
      if (
        medications.some(
          (item) =>
            normalize(item.name) === normalize(medicationName) &&
            item.change_date === medicationDate &&
            item.change_type === changeType,
        )
      ) {
        invalid('같은 날짜에 같은 약 변경이 이미 등록되어 있어요.')
        return
      }
    } else {
      if (!questionText.trim()) return
      if (
        questions.some(
          (item) =>
            item.created_at.slice(0, 10) === localToday() &&
            normalize(item.text) === normalize(questionText),
        )
      ) {
        invalid('오늘 저장한 같은 질문이 있어요.')
        return
      }
    }
    busyRef.current = true
    setBusy(true)
    setSavingKind(kind)
    try {
      let message: string
      let savedMedicationId: number | undefined
      let savedQuestionId: number | undefined
      if (kind === 'visits') {
        const saved = await api.addVisit({ visit_date: visitDate, status: visitStatus })
        setVisits((previous) => [...previous.filter((item) => item.id !== saved.id), saved])
        setVisitDate('')
        message = saved.status === '완료' ? '받은 진료를 등록했어요.' : '다음 예약을 등록했어요.'
      } else if (kind === 'medications') {
        if (!changeType) return
        const saved = await api.addMedication({
          name: medicationName.trim(),
          change_type: changeType,
          change_date: medicationDate,
        })
        setMedications((previous) => [...previous.filter((item) => item.id !== saved.id), saved])
        setMedicationName('')
        setMedicationDate('')
        setChangeType('')
        savedMedicationId = saved.id
        message = '약 변경을 저장했어요.'
      } else {
        const saved = await api.addQuestion({ text: questionText.trim() })
        setQuestions((previous) => [...previous.filter((item) => item.id !== saved.id), saved])
        setQuestionText('')
        savedQuestionId = saved.id
        message = '질문을 저장했어요.'
      }
      showFeedback({
        title: kind === 'visits' ? '등록했어요' : '저장했어요',
        message,
        tone: 'success',
        focusMedicationId: savedMedicationId,
        focusQuestionId: savedQuestionId,
      })
      publish()
    } catch (err) {
      showFeedback({
        title: kind === 'visits' ? '등록하지 못했어요' : '저장하지 못했어요',
        message: errorText(err),
        tone: 'error',
        retry: kind,
      })
    } finally {
      busyRef.current = false
      setBusy(false)
      setSavingKind(null)
    }
  }
  const add = (event: FormEvent, kind: ItemKind) => {
    event.preventDefault()
    void save(kind)
  }
  const changeVisitStatus = async () => {
    if (!activeRef.current || !pendingVisit || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setDialogError('')
    setFeedback(null)
    try {
      const status = pendingVisit.status === '완료' ? '예정' : '완료'
      const saved = await api.updateVisit(pendingVisit.id, { status })
      setVisits((previous) => previous.map((item) => (item.id === saved.id ? saved : item)))
      setPendingVisit(null)
      setManagedVisitId(null)
      setManagedMedicationId(null)
      setManagedQuestionId(null)
      showFeedback({
        title: '변경했어요',
        message: status === '완료' ? '진료 완료로 변경했어요.' : '진료 예정으로 변경했어요.',
        tone: 'success',
      })
      publish()
    } catch (err) {
      setDialogError(errorText(err))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!activeRef.current || !pendingDelete || busyRef.current) return
    const item = pendingDelete
    busyRef.current = true
    setBusy(true)
    setDialogError('')
    setFeedback(null)
    try {
      if (item.tab === 'visits') {
        await api.deleteVisit(item.id)
        setVisits((previous) => previous.filter((v) => v.id !== item.id))
      } else if (item.tab === 'medications') {
        await api.deleteMedication(item.id)
        setMedications((previous) => previous.filter((v) => v.id !== item.id))
      } else {
        await api.deleteQuestion(item.id)
        setQuestions((previous) => previous.filter((v) => v.id !== item.id))
      }
      setPendingDelete(null)
      setManagedVisitId(null)
      setManagedMedicationId(null)
      setManagedQuestionId(null)
      showFeedback({
        title: '삭제했어요',
        message:
          item.tab === 'visits'
            ? '진료일을 삭제했어요.'
            : item.tab === 'medications'
              ? '약 변경 기록을 삭제했어요.'
              : '질문을 삭제했어요.',
        tone: 'success',
      })
      publish()
    } catch (err) {
      setDialogError(errorText(err))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  const closeDelete = () => {
    if (!busyRef.current) {
      setPendingDelete(null)
      setDialogError('')
    }
  }
  const closeVisit = () => {
    if (!busyRef.current) {
      setPendingVisit(null)
      setDialogError('')
    }
  }
  const managedVisit = visits.find((visit) => visit.id === managedVisitId)
  const managedMedication = medications.find((medication) => medication.id === managedMedicationId)
  const managedQuestion = questions.find((question) => question.id === managedQuestionId)
  const openVisitStatus = (visit: Visit) => {
    setPendingVisit(visit)
    setPendingDelete(null)
    setDialogError('')
    setFeedback(null)
  }

  return (
    <div className="mvp-sc-page mvp-sc-v2 stack">
      <header className="mvp-sc-heading">
        <div>
          <h1 tabIndex={-1}>일정</h1>
          <p>진료일과 약 변경을 기록하고, 다음 진료에서 물어볼 것을 모아요.</p>
        </div>
      </header>
      <div className="mvp-sc-spec-tabs" role="tablist" aria-label="일정 항목">
        {tabs.map(({ id, label }, index) => (
          <button
            type="button"
            role="tab"
            key={id}
            id={`schedule-tab-${id}`}
            aria-controls={`schedule-panel-${id}`}
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            disabled={busy}
            onClick={() => selectTab(id)}
            onKeyDown={(event) => keyboardTab(event, index)}
          >
            {label}
          </button>
        ))}
      </div>
      {loadError && (
        <button
          type="button"
          className="button outline mvp-sc-reload"
          disabled={loading || busy}
          onClick={() => void refresh()}
        >
          기록 다시 불러오기
        </button>
      )}
      {loading && <p role="status">저장한 기록을 모으고 있어요…</p>}
      <div className="mvp-sc-panels">
        <section
          id="schedule-panel-visits"
          role={desktop ? 'region' : 'tabpanel'}
          aria-labelledby={desktop ? 'schedule-visits-heading' : 'schedule-tab-visits'}
          hidden={!desktop && tab !== 'visits'}
          className="card stack mvp-sc-visit-card"
        >
          <h2 id="schedule-visits-heading">진료일</h2>
          <form
            className="mvp-sc-visit-form stack"
            aria-label="진료 날짜 등록"
            onSubmit={(event) => void add(event, 'visits')}
          >
            <fieldset className="mvp-sc-fields" disabled={busy || loading || !visitsReady}>
              <fieldset className="mvp-visit-kind" aria-label="등록할 진료">
                {(['완료', '예정'] as const).map((status) => (
                  <label key={status}>
                    <input
                      type="radio"
                      name="visit-kind"
                      value={status}
                      checked={visitStatus === status}
                      onChange={() => {
                        setVisitStatus(status)
                        if (
                          visitDate &&
                          (status === '완료' ? visitDate > localToday() : visitDate < localToday())
                        )
                          setVisitDate('')
                      }}
                    />
                    {status === '완료' ? '받은 진료' : '다음 예약'}
                  </label>
                ))}
              </fieldset>
              <div className="mvp-sc-date-field">
                <label htmlFor="schedule-visit-date">
                  <CalendarDays size={20} aria-hidden="true" />
                  {visitStatus === '완료' ? '진료받은 날' : '다음 예약일'}
                </label>
                <input
                  id="schedule-visit-date"
                  type="date"
                  value={visitDate}
                  required
                  min={visitStatus === '예정' ? localToday() : undefined}
                  max={visitStatus === '완료' ? localToday() : undefined}
                  onChange={(event) => setVisitDate(event.target.value)}
                />
              </div>
              <button
                className="button wide"
                type="submit"
                disabled={busy || loading || !visitsReady || !visitDate}
              >
                {savingKind === 'visits'
                  ? '등록 중…'
                  : visitStatus === '완료'
                    ? '받은 진료 등록'
                    : '다음 예약 등록'}
              </button>
            </fieldset>
          </form>
          {(visitsReady || visits.length > 0) && (
            <VisitHistory
              visits={visits}
              today={localToday()}
              disabled={busy || loading || !visitsReady}
              onManage={(visit) => {
                setManagedVisitId(visit.id)
                setManagedMedicationId(null)
                setManagedQuestionId(null)
                setPendingVisit(null)
                setPendingDelete(null)
                setDialogError('')
                setFeedback(null)
              }}
              onComplete={(visit) => {
                setManagedVisitId(null)
                openVisitStatus(visit)
              }}
            />
          )}
        </section>
        <section
          id="schedule-panel-medications"
          role={desktop ? 'region' : 'tabpanel'}
          aria-labelledby={desktop ? 'schedule-medication-heading' : 'schedule-tab-medications'}
          hidden={!desktop && tab !== 'medications'}
          className="card stack mvp-sc-med-panel"
        >
          <h2 id="schedule-medication-heading">약 변경 기록</h2>
          <form
            className="stack mvp-sc-med-form"
            aria-label="약 변경 기록"
            onSubmit={(event) => add(event, 'medications')}
          >
            <fieldset className="mvp-sc-fields" disabled={busy || loading || !medicationsReady}>
              <label htmlFor="schedule-medication-name">
                약 이름
                <input
                  id="schedule-medication-name"
                  required
                  value={medicationName}
                  maxLength={100}
                  onChange={(event) => setMedicationName(event.target.value)}
                  placeholder="예) 쿠에티아핀"
                />
              </label>
              <fieldset className="mvp-med-choices">
                <legend>어떻게 바뀌었나요?</legend>
                {Object.entries(MEDICATION_CHANGE_LABELS).map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name="medication-change"
                      value={value}
                      required
                      checked={changeType === value}
                      onChange={() => setChangeType(value as Medication['change_type'])}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <label htmlFor="schedule-medication-date">
                바뀐 날
                <input
                  id="schedule-medication-date"
                  type="date"
                  className="itda-date-input"
                  value={medicationDate}
                  required
                  max={localToday()}
                  onChange={(event) => setMedicationDate(event.target.value)}
                />
              </label>
            </fieldset>
            <button
              className="button wide"
              type="submit"
              disabled={
                busy ||
                loading ||
                !medicationsReady ||
                !medicationName.trim() ||
                !changeType ||
                !medicationDate ||
                medicationDate > localToday()
              }
            >
              {savingKind === 'medications' ? '저장 중…' : '변경 내용 저장'}
            </button>
          </form>
          <p className="mvp-sc-hint">약을 바꾼 날을 경과와 요약지에서 함께 볼 수 있어요.</p>
          {(medicationsReady || medications.length > 0) && (
            <MedicationHistory
              medications={medications}
              disabled={busy || loading || !medicationsReady}
              revealId={active && (desktop || tab === 'medications') ? medicationRevealId : null}
              onManage={(medication) => {
                setManagedMedicationId(medication.id)
                setManagedVisitId(null)
                setManagedQuestionId(null)
                setPendingDelete(null)
                setPendingVisit(null)
                setDialogError('')
                setFeedback(null)
              }}
            />
          )}
        </section>
        <section
          id="schedule-panel-questions"
          role={desktop ? 'region' : 'tabpanel'}
          aria-labelledby={desktop ? 'schedule-questions-heading' : 'schedule-tab-questions'}
          hidden={!desktop && tab !== 'questions'}
          className="card stack mvp-sc-questions-panel"
        >
          <h2 id="schedule-questions-heading">의사에게 물어볼 것</h2>
          <form
            className="mvp-sc-question-form"
            aria-label="질문 저장"
            onSubmit={(event) => void add(event, 'questions')}
          >
            <textarea
              id="schedule-question-text"
              aria-label="다음 진료 때 묻고 싶은 것"
              disabled={busy}
              rows={3}
              value={questionText}
              maxLength={1000}
              onChange={(event) => setQuestionText(event.target.value)}
              placeholder="예) 밤에 자주 깨실 때 어떻게 도와드리면 좋을까요?"
              required
            />
            <button
              type="submit"
              className="button accent wide"
              disabled={busy || !questionText.trim() || loading || !questionsReady}
            >
              {savingKind === 'questions' ? '저장 중…' : '질문 저장'}
            </button>
          </form>
          {(questionsReady || questions.length > 0) && (
            <QuestionHistory
              questions={questions}
              period={summaryPeriod}
              loading={loading}
              disabled={busy || loading || !questionsReady}
              revealId={
                active &&
                (desktop || tab === 'questions') &&
                !feedback &&
                !pendingDelete &&
                !pendingVisit &&
                !managedVisit &&
                !managedMedication &&
                !managedQuestion
                  ? questionRevealId
                  : null
              }
              onRetry={() => void refresh()}
              onManage={(question) => {
                setManagedQuestionId(question.id)
                setManagedVisitId(null)
                setManagedMedicationId(null)
                setPendingDelete(null)
                setPendingVisit(null)
                setDialogError('')
                setFeedback(null)
              }}
            />
          )}
        </section>
      </div>
      <Modal
        open={active && Boolean(managedVisit) && !pendingDelete && !pendingVisit}
        title="진료일 관리"
        onClose={() => {
          if (!busyRef.current) setManagedVisitId(null)
        }}
        busy={busy}
        footer={
          managedVisit && (
            <>
              <button
                type="button"
                className="button outline"
                disabled={busy || loading || !visitsReady}
                onClick={() => {
                  setPendingDelete({
                    tab: 'visits',
                    id: managedVisit.id,
                    label: `${formatDate(managedVisit.visit_date)} 진료일`,
                    status: managedVisit.status,
                  })
                  setDialogError('')
                }}
              >
                진료일 삭제
              </button>
              {managedVisit.status === '완료' || managedVisit.visit_date <= localToday() ? (
                <button
                  type="button"
                  className="button"
                  disabled={busy || loading || !visitsReady}
                  onClick={() => openVisitStatus(managedVisit)}
                >
                  {managedVisit.status === '완료' ? '예정으로 변경' : '진료 완료'}
                </button>
              ) : (
                <button type="button" className="button" onClick={() => setManagedVisitId(null)}>
                  닫기
                </button>
              )}
            </>
          )
        }
      >
        {managedVisit && (
          <div className="mvp-visit-management-detail">
            <time dateTime={managedVisit.visit_date}>{formatDate(managedVisit.visit_date)}</time>
            <p>{managedVisit.status === '완료' ? '진료 완료' : '진료 예정'}</p>
          </div>
        )}
      </Modal>
      <Modal
        open={active && Boolean(managedMedication) && !pendingDelete}
        title="약 변경 기록 관리"
        onClose={() => {
          if (!busyRef.current) setManagedMedicationId(null)
        }}
        busy={busy}
        footer={
          managedMedication && (
            <>
              <button
                type="button"
                className="button outline"
                disabled={busy || loading || !medicationsReady}
                onClick={() => {
                  setPendingDelete({
                    tab: 'medications',
                    id: managedMedication.id,
                    label: `${managedMedication.name} ${medicationChangeLabel(managedMedication.change_type)}`,
                    detail: `${formatDate(managedMedication.change_date)} · ${managedMedication.name} · ${medicationChangeLabel(managedMedication.change_type)}`,
                  })
                  setDialogError('')
                }}
              >
                기록 삭제
              </button>
              <button type="button" className="button" onClick={() => setManagedMedicationId(null)}>
                닫기
              </button>
            </>
          )
        }
      >
        {managedMedication && (
          <div className="mvp-medication-management-detail">
            <p>
              <strong>{managedMedication.name}</strong>
              {' · '}
              {medicationChangeLabel(managedMedication.change_type)}
            </p>
            <time dateTime={managedMedication.change_date}>
              {formatDate(managedMedication.change_date)}
            </time>
          </div>
        )}
      </Modal>
      <Modal
        open={active && Boolean(managedQuestion) && !pendingDelete}
        title="질문 관리"
        onClose={() => {
          if (!busyRef.current) setManagedQuestionId(null)
        }}
        busy={busy}
        footer={
          managedQuestion && (
            <>
              <button
                type="button"
                className="button outline"
                disabled={busy || loading || !questionsReady}
                onClick={() => {
                  setPendingDelete({
                    tab: 'questions',
                    id: managedQuestion.id,
                    label: managedQuestion.text.slice(0, 25),
                    detail: managedQuestion.text,
                  })
                  setDialogError('')
                }}
              >
                질문 삭제
              </button>
              <button type="button" className="button" onClick={() => setManagedQuestionId(null)}>
                닫기
              </button>
            </>
          )
        }
      >
        {managedQuestion && (
          <div className="mvp-question-management-detail">
            <p>{managedQuestion.text}</p>
            <time dateTime={managedQuestion.created_at}>
              {formatDate(managedQuestion.created_at)}
            </time>
          </div>
        )}
      </Modal>
      <Modal
        open={active && Boolean(pendingDelete)}
        title={
          pendingDelete?.tab === 'visits'
            ? '진료일을 삭제할까요?'
            : pendingDelete?.tab === 'medications'
              ? '약 변경 기록을 삭제할까요?'
              : '질문을 삭제할까요?'
        }
        onClose={closeDelete}
        busy={busy}
        tone="danger"
        role="alertdialog"
        variant="message"
        footer={
          <>
            <button
              type="button"
              className="button outline"
              data-autofocus
              disabled={busy}
              onClick={closeDelete}
            >
              취소
            </button>
            <button
              type="button"
              className="button itda-danger-button"
              disabled={busy}
              onClick={() => void remove()}
            >
              {busy ? '삭제 중…' : dialogError ? '다시 삭제하기' : '삭제하기'}
            </button>
          </>
        }
      >
        <p className="mvp-sc-dialog-item">{pendingDelete?.detail ?? pendingDelete?.label}</p>
        <p>
          {pendingDelete?.tab === 'visits'
            ? pendingDelete.status === '예정'
              ? '등록한 진료 예정일이 목록에서 사라져요. 작성한 돌봄 기록은 남아 있어요.'
              : '이 진료일을 기준으로 한 요약 기간이 달라질 수 있어요. 작성한 돌봄 기록은 남아 있어요.'
            : pendingDelete?.tab === 'medications'
              ? '이 약 변경이 목록과 요약지에서 빠지고, 그래프의 약 변경 표시도 사라져요.'
              : '질문 목록과 해당 기간의 요약지에서 이 질문이 빠져요. 증상 통계는 바뀌지 않아요.'}
        </p>
        <p>삭제한 항목은 되돌릴 수 없어요.</p>
        {dialogError && (
          <p className="mvp-sc-dialog-error" role="alert">
            삭제하지 못했어요. {dialogError}
          </p>
        )}
      </Modal>
      <Modal
        open={active && Boolean(pendingVisit)}
        title={
          pendingVisit?.status === '완료' ? '진료 예정으로 변경할까요?' : '진료 완료로 변경할까요?'
        }
        onClose={closeVisit}
        busy={busy}
        role="alertdialog"
        variant="message"
        footer={
          <>
            <button
              type="button"
              className="button outline"
              data-autofocus
              disabled={busy}
              onClick={closeVisit}
            >
              취소
            </button>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void changeVisitStatus()}
            >
              {busy
                ? '변경 중…'
                : dialogError
                  ? '다시 변경하기'
                  : pendingVisit?.status === '완료'
                    ? '예정으로 변경'
                    : '진료 완료'}
            </button>
          </>
        }
      >
        <p className="mvp-sc-dialog-item">{pendingVisit && formatDate(pendingVisit.visit_date)}</p>
        <p>진료 상태를 바꾸면 요약 기간이 달라질 수 있어요.</p>
        {dialogError && (
          <p className="mvp-sc-dialog-error" role="alert">
            변경하지 못했어요. {dialogError}
          </p>
        )}
      </Modal>
      {active &&
        feedback &&
        !pendingDelete &&
        !pendingVisit &&
        !managedVisit &&
        !managedMedication &&
        !managedQuestion && (
          <FeedbackDialog
            title={feedback.title}
            message={feedback.message}
            tone={feedback.tone}
            onClose={() => {
              if (feedback.focusMedicationId !== undefined) {
                setTab('medications')
                setMedicationRevealId(feedback.focusMedicationId)
              }
              if (feedback.focusQuestionId !== undefined) {
                setTab('questions')
                setQuestionRevealId(feedback.focusQuestionId)
              }
              setFeedback(null)
            }}
            action={
              feedback.retry
                ? {
                    label:
                      feedback.retry === 'load'
                        ? '다시 불러오기'
                        : feedback.retry === 'visits'
                          ? '다시 등록하기'
                          : '다시 저장하기',
                    disabled: busy || loading,
                    onClick: () => {
                      const retry = feedback.retry
                      setFeedback(null)
                      if (retry === 'load') void refresh()
                      else if (retry) void save(retry)
                    },
                  }
                : undefined
            }
          />
        )}
    </div>
  )
}

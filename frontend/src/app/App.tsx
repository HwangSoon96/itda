import { lazy, Suspense } from 'react'
import { Settings } from 'lucide-react'
import { apiCapabilities, USE_MOCK } from '../api'
import { RecordPage } from '../features/records'
import { SchedulePage } from '../features/schedule'
import { reportHref } from '../shared/lib/reportSelection'
import { BrandLogo, FeedbackDialog, Modal } from '../shared/ui'
import { ErrorBoundary } from './ErrorBoundary'
import { modelStatusLabel } from './modelStatus'
import { navigation } from './navigation'
import { useWorkspaceController } from './useWorkspaceController'

const ProgressPage = lazy(() =>
  import('../features/progress').then((module) => ({ default: module.ProgressPage })),
)
const SummaryPage = lazy(() =>
  import('../features/summary').then((module) => ({ default: module.SummaryPage })),
)

function Workspace() {
  const {
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
  } = useWorkspaceController()
  return (
    <div className="mvp-shell">
      <header className="mvp-sidebar">
        <div className="mvp-header">
          <a href={reportHref('record')} aria-label="잇다 기록">
            <BrandLogo />
            <span>잇다</span>
          </a>
        </div>
        <nav className="mvp-navigation" aria-label="주 메뉴">
          {navigation.map(({ key, label, Icon }) => (
            <a href={reportHref(key)} key={key} aria-current={page === key ? 'page' : undefined}>
              <Icon size={22} strokeWidth={1.6} aria-hidden="true" />
              <span>{label}</span>
            </a>
          ))}
        </nav>
        <div className="mvp-account">
          <div className="mvp-header-actions">
            <span
              className={`mvp-model-state ${health?.ai_available && !connectionError ? 'is-ready' : ''}`}
              role="status"
            >
              <i aria-hidden="true" />
              {modelStatusLabel(health, connectionError)}
            </span>
            {apiCapabilities.demo && health?.demo_loaded && (
              <span
                className="mvp-demo-badge"
                aria-label="가상 기록으로 체험 중"
                title="가상 기록으로 체험 중"
              >
                데모
              </span>
            )}
            {apiCapabilities.demo && (
              <button
                className="button outline mvp-header-demo"
                onClick={() => void switchDemo()}
                disabled={busy || !health || !workspaceReady}
              >
                {health?.demo_loaded ? '내 기록으로' : '데모 불러오기'}
              </button>
            )}
            <details ref={utilityMenu} className="mvp-utilities">
              <summary aria-label="관리">
                <Settings size={18} aria-hidden="true" />
                <span className="sr-only">관리</span>
              </summary>
              <div>
                {apiCapabilities.patient && (
                  <>
                    <p>{alias || '환자'}</p>
                    <button disabled={!workspaceReady || busy} onClick={openAlias}>
                      환자 이름 설정
                    </button>
                  </>
                )}
                {apiCapabilities.demo && (
                  <button
                    onClick={() => void switchDemo()}
                    disabled={busy || !health || !workspaceReady}
                  >
                    {health?.demo_loaded ? '내 기록으로 돌아가기' : '데모 기록 불러오기'}
                  </button>
                )}
                <button onClick={retryConnection} disabled={refreshing || busy}>
                  연결 다시 확인
                </button>
                <p>이 PC에 저장됩니다.</p>
                {health?.allow_lan && <p>같은 Wi-Fi에 연결된 다른 사람도 기록을 볼 수 있어요.</p>}
                {USE_MOCK && <p>화면 검증용 샘플 모드입니다. 새로고침하면 입력이 초기화됩니다.</p>}
                {health?.temporary_model && (
                  <p>임시 AI로 시험 중입니다. 정리된 내용은 확인 후 저장해 주세요.</p>
                )}
              </div>
            </details>
          </div>
        </div>
      </header>
      <main className="mvp-main">
        {apiCapabilities.patient && patientError && workspaceReady && (
          <section className="mvp-notice" role="status">
            <p>환자 이름을 불러오지 못했어요. {patientError}</p>
            <button
              className="button outline"
              onClick={() => void retryPatient()}
              disabled={patientLoading || busy}
            >
              이름 다시 불러오기
            </button>
          </section>
        )}
        {(!health || (!apiCapabilities.workspace && !workspaceReady)) &&
          !refreshing &&
          connectionError && (
            <section className="card">
              <h1>PC 연결을 확인해 주세요</h1>
              <button className="button" onClick={retryConnection}>
                연결 다시 확인
              </button>
            </section>
          )}
        {apiCapabilities.workspace && !workspaceReady && (health || workspaceChanged) && (
          <section className="card" role="status">
            <h2>{workspaceChanged ? '기록 공간이 바뀌었어요' : '기록 공간을 확인하고 있어요'}</h2>
            <p>
              {workspaceChanged
                ? '작성 중인 내용은 잠시 보관하고 입력을 멈췄어요. 현재 기록 공간을 열면 저장하지 않은 입력이 닫혀요.'
                : apiCapabilities.demo
                  ? '내 기록과 데모 기록 중 어느 공간인지 확인한 뒤 이어갈 수 있어요.'
                  : '현재 기록 공간을 확인한 뒤 이어갈 수 있어요.'}
            </p>
            <button
              className="button outline"
              onClick={() => void recoverWorkspace()}
              disabled={refreshing || busy}
            >
              기록 공간 다시 확인
            </button>
          </section>
        )}
        {refreshing && !health && (
          <p className="card" role="status">
            PC에 저장한 기록을 확인하고 있어요…
          </p>
        )}
        {health && (
          <div key={workspace} hidden={!workspaceReady} inert={!workspaceReady}>
            <div data-page="record" hidden={page !== 'record'}>
              <RecordPage health={health} active={workspaceReady && page === 'record'} />
            </div>
            <div data-page="schedule" hidden={page !== 'schedule'}>
              <SchedulePage active={workspaceReady && page === 'schedule'} />
            </div>
            <div data-page="progress" hidden={page !== 'progress'}>
              {page === 'progress' &&
                (health ? (
                  <Suspense fallback={<p role="status">경과를 불러오는 중…</p>}>
                    <ProgressPage health={health} active={workspaceReady && page === 'progress'} />
                  </Suspense>
                ) : (
                  <p className="card">경과를 보려면 PC 연결을 확인해 주세요.</p>
                ))}
            </div>
            <div data-page="summary" hidden={page !== 'summary'}>
              {(summaryVisited || page === 'summary') && (
                <Suspense fallback={<p role="status">요약지를 불러오는 중…</p>}>
                  <SummaryPage health={health} active={workspaceReady && page === 'summary'} />
                </Suspense>
              )}
            </div>
          </div>
        )}
      </main>
      <Modal
        open={apiCapabilities.patient && aliasOpen && workspaceReady}
        title="환자 이름 설정"
        onClose={() => void closeAlias()}
        busy={busy}
        footer={
          <>
            <button
              className="button outline"
              type="button"
              disabled={busy}
              onClick={() => void closeAlias()}
            >
              취소
            </button>
            <button
              type="submit"
              form="patient-alias-form"
              className="button"
              disabled={busy || !aliasInput.trim()}
            >
              {busy ? '저장 중…' : '저장'}
            </button>
          </>
        }
      >
        <form id="patient-alias-form" onSubmit={(event) => void saveAlias(event)}>
          <p>요약지에 표시할 이름이나 가명을 적어 주세요.</p>
          <label>
            이름 또는 가명
            <input
              data-autofocus
              maxLength={50}
              required
              disabled={busy}
              value={aliasInput}
              onChange={(event) => setAliasInput(event.target.value)}
            />
          </label>
          {utilityError && <p role="alert">{utilityError}</p>}
        </form>
      </Modal>
      <FeedbackDialog
        message={
          (!aliasOpen || !workspaceReady) && !confirmation.pending
            ? utilityError || connectionNotice || utilityNotice
            : ''
        }
        title={
          connectionNotice
            ? 'PC 연결을 확인해 주세요'
            : utilityError
              ? '처리하지 못했어요'
              : undefined
        }
        tone={utilityError || connectionNotice ? 'error' : 'success'}
        onClose={dismissFeedback}
        action={
          connectionNotice
            ? {
                label: refreshing ? '연결 확인 중…' : '연결 다시 확인',
                disabled: refreshing || busy,
                onClick: retryFeedback,
              }
            : undefined
        }
      />
      {confirmation.dialog}
    </div>
  )
}
export default function App() {
  return (
    <ErrorBoundary>
      <Workspace />
    </ErrorBoundary>
  )
}

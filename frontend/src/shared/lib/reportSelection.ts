import { useEffect, useState, useSyncExternalStore } from 'react'
import { localToday } from './date'

function query(hash = window.location.hash) {
  return new URLSearchParams(hash.split('?')[1] ?? '')
}
function validDate(value: string | null): value is string {
  return Boolean(
    value &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value,
  )
}
function selection(hash = window.location.hash) {
  const params = query(hash)
  const asOf = params.get('as_of')
  const start = params.get('period_start')
  const today = localToday()
  const future = validDate(asOf) && asOf > today
  const resetStart = future && validDate(start) && start > today
  return {
    asOf: validDate(asOf) && !future ? asOf : today,
    isFixed: validDate(asOf),
    periodStart: validDate(start) && !resetStart ? start : null,
    notice: future
      ? `미래 날짜는 요약 기준일로 사용할 수 없어 오늘(${today})로 바꿨어요.${resetStart ? ' 오늘보다 뒤인 시작일 고정도 해제했어요.' : ''}`
      : '',
  }
}
export function reportHref(page: string, extra: Record<string, string> = {}) {
  const current = selection()
  const params = new URLSearchParams(extra)
  if (current.isFixed) params.set('as_of', current.asOf)
  else params.delete('as_of')
  if (current.periodStart) params.set('period_start', current.periodStart)
  return `#${page}${params.size ? `?${params}` : ''}`
}
function subscribe(update: () => void) {
  let timer: ReturnType<typeof setTimeout>
  const refreshDay = () => {
    update()
    clearTimeout(timer)
    const now = new Date()
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    timer = setTimeout(refreshDay, midnight.getTime() - now.getTime() + 25)
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') refreshDay()
  }
  window.addEventListener('hashchange', update)
  window.addEventListener('popstate', update)
  window.addEventListener('focus', refreshDay)
  document.addEventListener('visibilitychange', onVisible)
  refreshDay()
  return () => {
    clearTimeout(timer)
    window.removeEventListener('hashchange', update)
    window.removeEventListener('popstate', update)
    window.removeEventListener('focus', refreshDay)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
function snapshot() {
  return `${window.location.hash}\n${localToday()}`
}
function write(patch: { asOf?: string | null; periodStart?: string | null }, replace = false) {
  const current = selection()
  const fixedDate = patch.asOf === undefined ? (current.isFixed ? current.asOf : null) : patch.asOf
  const next = { ...current, ...patch, asOf: fixedDate ?? localToday() }
  if (
    !validDate(next.asOf) ||
    (next.periodStart && (!validDate(next.periodStart) || next.periodStart > next.asOf))
  )
    return
  const page = window.location.hash.slice(1).split('?')[0] || 'summary'
  const params = query()
  if (fixedDate) params.set('as_of', fixedDate)
  else params.delete('as_of')
  if (next.periodStart) params.set('period_start', next.periodStart)
  else params.delete('period_start')
  const hash = `#${page}${params.size ? `?${params}` : ''}`
  if (hash === window.location.hash) return
  window.history[replace ? 'replaceState' : 'pushState'](null, '', hash)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}
export function useReportSelection() {
  const state = useSyncExternalStore(subscribe, snapshot)
  const hash = state.split('\n')[0]
  const current = selection(hash)
  const key = `${current.asOf}|${current.periodStart ?? ''}`
  const [notice, setNotice] = useState({ key, text: current.notice })
  // Only explicit date selections are pinned. The default follows today,
  // including an open tab crossing midnight or waking from sleep.
  useEffect(() => {
    const value = selection()
    if (value.notice)
      setNotice({ key: `${value.asOf}|${value.periodStart ?? ''}`, text: value.notice })
    if (value.notice) write({ asOf: value.asOf, periodStart: value.periodStart }, true)
    else if (query().has('as_of') && !validDate(query().get('as_of'))) write({ asOf: null }, true)
  }, [state])
  return {
    asOf: current.asOf,
    periodStart: current.periodStart,
    isFixed: current.isFixed,
    notice: current.notice || (notice.key === key ? notice.text : ''),
    resetPeriod: () => {
      setNotice({ key: '', text: '' })
      write({ asOf: null, periodStart: null })
    },
    setPeriod: (period: { asOf: string; periodStart: string | null }) => {
      const today = localToday()
      const future = validDate(period.asOf) && period.asOf > today
      const asOf = future ? today : period.asOf
      const periodStart =
        future && period.periodStart && period.periodStart > today ? null : period.periodStart
      setNotice({
        key: `${asOf}|${periodStart ?? ''}`,
        text: future ? `미래 날짜는 마지막 날짜로 사용할 수 없어 오늘(${today})로 바꿨어요.` : '',
      })
      write({ asOf, periodStart })
    },
    setAsOf: (asOf: string) => {
      if (validDate(asOf) && asOf > localToday()) {
        setNotice({
          key: `${localToday()}|${current.periodStart ?? ''}`,
          text: `미래 날짜는 요약 기준일로 사용할 수 없어 오늘(${localToday()})로 바꿨어요.`,
        })
        write({ asOf: localToday() })
      } else {
        setNotice({ key: '', text: '' })
        write({ asOf })
      }
    },
    setPeriodStart: (periodStart: string | null) => {
      setNotice({ key: '', text: '' })
      write({ periodStart })
    },
  }
}

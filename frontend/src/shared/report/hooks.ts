import { useEffect, useRef, useState } from 'react'
import { api } from '../../api'
import type { EventType, MemoResult, Summary, Trends } from '../../api/types'
import { localToday } from '../lib/date'
import { errorText } from './format'

/**
 * Default report range shown in the period fields.
 * - previous visit → today (with or without a next visit)
 * - no previous visit, next visit → first record → next visit
 * - no visits → first record → today (today → today without records)
 * `firstRecord` is the server's default start, which already falls back to today
 * without records. `end: undefined` means "follow today"; `null` leaves the field blank.
 */
export function useVisitPeriod(active: boolean, firstRecord?: string) {
  const [visits, setVisits] = useState<{ previous?: string; next?: string } | null>(null)
  useEffect(() => {
    if (!active) return
    let alive = true
    api
      .visits()
      .then((items) => {
        if (!alive) return
        const today = localToday()
        const dates = items.map((visit) => visit.visit_date).sort()
        setVisits({
          previous: dates.filter((date) => date <= today).at(-1),
          next: dates.find((date) => date > today),
        })
      })
      .catch(() => {
        if (alive) setVisits({})
      })
    return () => {
      alive = false
    }
  }, [active])
  if (visits?.previous) return { start: visits.previous, end: undefined }
  if (visits?.next) return { start: firstRecord, end: visits.next }
  if (visits) return { start: firstRecord, end: undefined }
  return { start: undefined, end: null }
}

export function useSummary(
  asOf: string,
  active: boolean,
  periodStart: string | null = null,
  ai = false,
) {
  const [data, setData] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [settledKey, setSettledKey] = useState('')
  const cache = useRef(new Map<string, { promise: Promise<Summary>; value?: Summary }>())
  const requestKey = `${asOf}|${periodStart ?? ''}|${ai}|${revision}`
  function invalidate() {
    cache.current.clear()
    setRevision((value) => value + 1)
  }
  useEffect(() => {
    window.addEventListener('itda-final-updated', invalidate)
    return () => window.removeEventListener('itda-final-updated', invalidate)
  }, [])
  useEffect(() => {
    if (!active) return
    let alive = true
    let entry = cache.current.get(requestKey)
    if (entry?.value) {
      setData(entry.value)
      setLoading(false)
      setError('')
      setSettledKey(requestKey)
      return
    }
    if (!entry) {
      const created = { promise: api.summary(asOf, periodStart ?? undefined, ai) } as {
        promise: Promise<Summary>
        value?: Summary
      }
      // Navigation only detaches the view. The same in-flight result can finish
      // into its original slot, never into a newer data revision or workspace.
      created.promise = created.promise
        .then((value) => {
          if (cache.current.get(requestKey) === created) created.value = value
          return value
        })
        .catch((failure) => {
          if (cache.current.get(requestKey) === created) cache.current.delete(requestKey)
          throw failure
        })
      cache.current.set(requestKey, created)
      entry = created
    }
    setLoading(true)
    setError('')
    const current = entry
    current.promise
      .then((value) => {
        if (alive && cache.current.get(requestKey) === current) setData(value)
      })
      .catch((failure) => {
        if (alive) setError(errorText(failure))
      })
      .finally(() => {
        if (alive) {
          setLoading(false)
          setSettledKey(requestKey)
        }
      })
    return () => {
      alive = false
    }
  }, [asOf, active, revision, periodStart, ai, requestKey])
  const completed = cache.current.get(requestKey)?.value
  return {
    data: completed ?? data,
    loading: completed ? false : loading || settledKey !== requestKey,
    error: completed ? '' : error,
    reload: invalidate,
  }
}

export function useTrends(
  type: EventType,
  asOf: string,
  active: boolean,
  periodStart: string | null = null,
) {
  const [data, setData] = useState<Trends | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!active) return
    let alive = true
    setData(null)
    setError('')
    api
      .trends(type, asOf, periodStart ?? undefined)
      .then((value) => {
        if (alive) setData(value)
      })
      .catch((failure) => {
        if (alive) setError(errorText(failure))
      })
    return () => {
      alive = false
    }
  }, [type, asOf, active, periodStart, revision])
  return { data, error, reload: () => setRevision((value) => value + 1) }
}

export function useReportMemos(data: Summary | null, active: boolean) {
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{
    data: Summary
    memos: MemoResult[]
    error: string
  } | null>(null)
  useEffect(() => {
    if (!active || !data) return
    let alive = true
    setResult(null)
    api
      .memos({})
      .then((memos) => {
        if (alive)
          setResult({ data, memos: memos.filter((memo) => memo.status === '확인 완료'), error: '' })
      })
      .catch((error) => {
        if (alive) setResult({ data, memos: [], error: errorText(error) })
      })
    return () => {
      alive = false
    }
  }, [data, active, revision])
  const current = result?.data === data ? result : null
  return {
    memos: current?.memos ?? [],
    error: current?.error ?? '',
    loading: Boolean(data && !current),
    reload: () => setRevision((value) => value + 1),
  }
}

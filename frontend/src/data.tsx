import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from './auth'
import { api, ApiError, text, type ApiRecord, type Attachment, type Counts } from './lib/api'

export interface Product {
  id: string
  name: string
  status: string
  logo?: string
}

interface Workspace {
  products: Product[]
  counts: Counts
  // user id -> name, for showing who a record is assigned to
  userNames: Map<string, string>
  reload: () => Promise<void>
}

const WorkspaceContext = createContext<Workspace | null>(null)

// Products and counts, loaded once for every page inside the shell
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { expire } = useAuth()
  const [data, setData] = useState<{ products: ApiRecord[]; users: ApiRecord[]; counts: Counts }>()
  const [error, setError] = useState<string>()

  const reload = useCallback(
    () =>
      api<{ products: ApiRecord[]; users: ApiRecord[]; counts: Counts }>('/bootstrap')
        .then(setData)
        .catch((err: Error) => (err instanceof ApiError && err.status === 401 ? expire() : setError(err.message))),
    [expire],
  )

  useEffect(() => {
    void reload()
  }, [reload])

  const products = useMemo(
    () =>
      (data?.products ?? [])
        .map((record) => ({
          id: record.id,
          name: text(record, 'Product Name') || 'Untitled',
          status: text(record, 'Status'),
          logo: (record.fields['Product Logo'] as Attachment[] | undefined)?.[0]?.url,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  )

  const userNames = useMemo(() => new Map((data?.users ?? []).map((user) => [user.id, text(user, 'Name')])), [data])

  if (!data) {
    return error ? (
      <p className="p-8 text-sm text-red-700">Could not load the dashboard: {error}</p>
    ) : (
      <p className="p-8 text-sm text-neutral-500">Loading…</p>
    )
  }

  return <WorkspaceContext value={{ products, counts: data.counts, userNames, reload }}>{children}</WorkspaceContext>
}

export function useWorkspace() {
  const workspace = use(WorkspaceContext)
  if (!workspace) throw new Error('useWorkspace must be used inside WorkspaceProvider')
  return workspace
}

// One GET, refetched when the path changes. A null path waits, for a request that needs an earlier answer.
export function useFetch<T>(path: string | null) {
  const { expire } = useAuth()
  const [result, setResult] = useState<{ path: string | null; data?: T; error?: ApiError | Error }>({ path })
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (path === null) return
    let stale = false
    api<T>(path)
      .then((data) => !stale && setResult({ path, data }))
      .catch((err: Error) => {
        if (stale) return
        if (err instanceof ApiError && err.status === 401) expire()
        else setResult({ path, error: err })
      })
    return () => {
      stale = true
    }
  }, [path, version, expire])

  // an answer for an earlier path is not shown under the new one
  const current = result.path === path ? result : undefined
  return {
    data: current?.data,
    error: current?.error,
    loading: path !== null && !current?.data && !current?.error,
    reload: () => setVersion((v) => v + 1),
  }
}

const PAGE = 1000

// Every row of a paged list route (/videos, /images), read page by page until
// the route's `total` is reached. `path` carries the filters but no limit or offset;
// null while there is nothing to read yet.
export function useAllPages<T>(path: string | null) {
  const { expire } = useAuth()
  const [result, setResult] = useState<{ path: string | null; data?: { records: T[] }; error?: ApiError | Error }>({ path })
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (path === null) return
    let stale = false
    const joiner = path.includes('?') ? '&' : '?'
    ;(async () => {
      const records: T[] = []
      for (;;) {
        const page = await api<{ records: T[]; total: number }>(`${path}${joiner}limit=${PAGE}&offset=${records.length}`)
        records.push(...page.records)
        if (page.records.length < PAGE || records.length >= page.total) return records
      }
    })()
      .then((records) => !stale && setResult({ path, data: { records } }))
      .catch((err: Error) => {
        if (stale) return
        if (err instanceof ApiError && err.status === 401) expire()
        else setResult({ path, error: err })
      })
    return () => {
      stale = true
    }
  }, [path, version, expire])

  const current = result.path === path ? result : undefined
  return {
    data: current?.data,
    error: current?.error,
    loading: path !== null && !current?.data && !current?.error,
    reload: () => setVersion((v) => v + 1),
  }
}

// A list from the data API. `query` uses the API's own parameters (fields, sort, where[Field]).
export function useRecords(table: string, query: Record<string, string>) {
  const { expire } = useAuth()
  const key = `${table}?${new URLSearchParams(query)}`
  const [result, setResult] = useState<{ key: string; records?: ApiRecord[]; error?: string }>({ key })
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let stale = false
    setLoading(true)
    api<{ records: ApiRecord[] }>(`/data/${key}`)
      .then((res) => !stale && setResult({ key, records: res.records }))
      .catch((err: Error) => {
        if (stale) return
        if (err instanceof ApiError && err.status === 401) expire()
        else setResult({ key, error: err.message })
      })
      .finally(() => !stale && setLoading(false))
    return () => {
      stale = true
    }
  }, [key, version, expire])

  // a result for an earlier query is not shown under the new one
  const current = result.key === key ? result : undefined
  return { records: current?.records, error: current?.error, loading, reload: () => setVersion((v) => v + 1) }
}

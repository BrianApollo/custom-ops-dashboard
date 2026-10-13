import { createContext, use, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError, type User } from './lib/api'

interface Auth {
  // undefined while the session is being checked, null when logged out
  user: User | null | undefined
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  // the API answered 401: the session ended somewhere else
  expire: () => void
}

const AuthContext = createContext<Auth | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>()
  const [error, setError] = useState<Error>()

  useEffect(() => {
    api<{ user: User }>('/auth/me')
      .then((res) => setUser(res.user))
      .catch((err: Error) => (err instanceof ApiError && err.status === 401 ? setUser(null) : setError(err)))
  }, [])

  // stable, so effects that depend on these do not re-run on every render
  const actions = useMemo(
    () => ({
      async login(email: string, password: string) {
        const res = await api<{ user: User }>('/auth/login', { method: 'POST', body: { email, password } })
        setUser(res.user)
      },
      async logout() {
        // an already-ended session is still a successful logout
        await api('/auth/logout', { method: 'POST' }).catch((err: Error) => {
          if (!(err instanceof ApiError && err.status === 401)) throw err
        })
        setUser(null)
      },
      expire: () => setUser(null),
    }),
    [],
  )

  if (error) {
    return <p className="p-8 text-sm text-red-700">Could not reach the API: {error.message}</p>
  }

  const auth: Auth = { user, ...actions }

  return <AuthContext value={auth}>{children}</AuthContext>
}

export function useAuth() {
  const auth = use(AuthContext)
  if (!auth) throw new Error('useAuth must be used inside AuthProvider')
  return auth
}

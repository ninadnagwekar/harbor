import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import { api, setUnauthorizedHandler } from "@/lib/api"
import type { User } from "@/lib/types"

type AuthValue = {
  user: User | null
  loading: boolean
  needsSetup: boolean
  refresh: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

function isPublic(path: string) {
  return ["/login", "/setup", "/forgot", "/invite", "/reset"].some((item) => path.startsWith(item))
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(null)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    const status = await api<{ needs_setup: boolean }>("/api/auth/status")
    setNeedsSetup(status.needs_setup)
    if (status.needs_setup) {
      setUser(null)
      return
    }
    try {
      setUser(await api<User>("/api/auth/me"))
    } catch {
      setUser(null)
    }
  }

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null)
      if (!isPublic(window.location.pathname)) navigate("/login")
    })
    refresh().finally(() => setLoading(false))
  }, [navigate])

  const value = useMemo<AuthValue>(
    () => ({
      user,
      loading,
      needsSetup,
      refresh,
      login: async (email, password) => {
        const next = await api<User>("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        })
        setUser(next)
        setNeedsSetup(false)
      },
      logout: async () => {
        await api("/api/auth/logout", { method: "POST" })
        setUser(null)
        navigate("/login")
      },
    }),
    [user, loading, needsSetup, navigate],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error("useAuth must be used inside AuthProvider")
  return value
}

import { createContext, useContext, useState, ReactNode } from 'react'

interface AuthUser {
  userId: string
  username: string
}

interface AuthContextValue {
  token: string | null
  user: AuthUser | null
  login: (token: string, userId: string, username: string) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'))
  const [user, setUser] = useState<AuthUser | null>(() => {
    const raw = localStorage.getItem('user')
    return raw ? JSON.parse(raw) : null
  })

  function login(token: string, userId: string, username: string) {
    const u = { userId, username }
    localStorage.setItem('token', token)
    localStorage.setItem('user', JSON.stringify(u))
    setToken(token)
    setUser(u)
  }

  function logout() {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ token, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

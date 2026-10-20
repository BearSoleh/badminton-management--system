import { createContext, useContext } from 'react'
import type { Membership } from './api'

export type AuthState = {
  membership: Membership | null
  authenticated: boolean
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  logout: () => Promise<void>
}
export const AuthContext = createContext<AuthState | null>(null)
export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('Auth provider is required')
  return value
}

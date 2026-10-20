import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { getMyMembership, SessionExpiredError } from './api'
import type { Membership } from './api'
import { AuthContext } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [membership, setMembership] = useState<Membership | null>(null)
  const [authenticated, setAuthenticated] = useState(false)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const invalidate = useCallback(() => { generation.current++ }, [])

  const load = useCallback(async (hasSession: boolean, background = false) => {
    const request = ++generation.current
    if (!background || !hasSession) setMembership(null)
    setAuthenticated(hasSession)
    setError(null)
    if (!hasSession) { setLoading(false); return }
    if (!background) setLoading(true)
    try {
      const account = await getMyMembership()
      if (request === generation.current) setMembership(account)
    } catch (cause) {
      if (request !== generation.current) return
      if (cause instanceof SessionExpiredError) {
        setAuthenticated(false)
        await supabase?.auth.signOut({ scope: 'local' })
      } else setError('We couldn’t load your account. Check your connection and try again.')
    } finally { if (request === generation.current) setLoading(false) }
  }, [])

  useEffect(() => {
    if (!supabase) return
    const pending = new Set<ReturnType<typeof setTimeout>>()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // Never await another Auth operation inside its event callback/lock.
      const timer = setTimeout(() => { pending.delete(timer); void load(Boolean(session)) }, 0)
      pending.add(timer)
    })
    return () => { subscription.unsubscribe(); for (const timer of pending) clearTimeout(timer); invalidate() }
  }, [load, invalidate])

  const refresh = useCallback(async () => {
    if (!supabase) return
    const { data: { session } } = await supabase.auth.getSession()
    await load(Boolean(session), true)
  }, [load])

  const logout = useCallback(async () => {
    // Clear private UI immediately, including during a slow/offline logout.
    generation.current++
    setMembership(null); setAuthenticated(false); setLoading(false); setError(null)
    const result = await supabase?.auth.signOut({ scope: 'local' })
    if (result?.error) setError('Unable to finish logging out. Please try again when your connection returns.')
  }, [])

  return <AuthContext.Provider value={{ membership, authenticated, loading, error, refresh, logout }}>{children}</AuthContext.Provider>
}

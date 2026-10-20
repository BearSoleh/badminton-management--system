import { BrowserRouter, Link, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { AuthProvider } from '../features/auth/AuthProvider'
import { useAuth } from '../features/auth/auth-context'
import { AccountStatusPage, AuthLayout, AuthPage, MemberHome, ProfilePage, RecoveryPage } from '../features/auth/AuthPages'
import { Brand } from './Brand'

function Protected({ active = false }: { active?: boolean }) {
  const { authenticated, loading, membership, error, refresh, logout } = useAuth()
  if (loading) return <AuthLayout><p role="status" className="loading-state">Opening your club…</p></AuthLayout>
  if (!authenticated) return <Navigate to="/login" replace />
  if (error || !membership) return <AuthLayout><h2>We couldn’t open your account.</h2><p role="alert">{error ?? 'Please try again.'}</p><button className="button primary mt-6" onClick={() => void refresh()}>Try again</button><button className="button text" onClick={() => void logout()}>Log out</button></AuthLayout>
  if (active && membership.status !== 'active') return <Navigate to="/account-status" replace />
  return <Outlet />
}
function MemberLayout() {
  const { logout } = useAuth()
  return <div className="member-shell"><header className="member-header"><Brand /><button className="button text" onClick={() => void logout()}><LogOut size={18} aria-hidden="true" />Log out</button></header><main id="main-content" tabIndex={-1} className="member-content"><Outlet /></main><footer className="member-footer">BJBC · A shared love of the game.</footer></div>
}
function HomeRedirect() {
  const { authenticated, loading } = useAuth()
  if (loading) return <AuthLayout><p role="status">Opening your club…</p></AuthLayout>
  return <Navigate to={authenticated ? '/app' : '/login'} replace />
}
export function AppRouter() {
  return <BrowserRouter><AuthProvider><a className="skip-link" href="#main-content">Skip to content</a><Routes>
    <Route path="/" element={<HomeRedirect />} />
    <Route path="/login" element={<AuthPage key="login" mode="login" />} />
    <Route path="/register" element={<AuthPage key="register" mode="register" />} />
    <Route path="/recovery" element={<RecoveryPage />} />
    <Route element={<Protected />}><Route path="/account-status" element={<AccountStatusPage />} /></Route>
    <Route element={<Protected active />}><Route path="/app" element={<MemberLayout />}><Route index element={<MemberHome />} /><Route path="profile" element={<ProfilePage />} /></Route></Route>
    <Route path="*" element={<AuthLayout><h2>That page isn’t here.</h2><p>Let’s get you back to your club.</p><Link to="/" className="button primary mt-6">Back to BJBC</Link></AuthLayout>} />
  </Routes></AuthProvider></BrowserRouter>
}

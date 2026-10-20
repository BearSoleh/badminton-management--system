import { useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, ArrowUpRight, Check, CircleAlert, Clock3, Eye, EyeOff, LockKeyhole, LogOut, ShieldCheck } from 'lucide-react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Brand } from '../../app/Brand'
import { supabase } from '../../lib/supabase'
import { useAuth } from './auth-context'
import { login, register, updateDisplayName } from './api'

function ConnectionNotice() {
  return !supabase && <div className="notice" role="status"><CircleAlert size={20} aria-hidden="true" /><div><strong>Club connection is being set up.</strong><p>You can explore these screens. Registration and login will be available once the club’s backend is connected.</p></div></div>
}

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="auth-layout">
    <aside className="club-panel">
      <Brand />
      <div className="club-story"><h1>A place on court.<br /><span>A club to belong to.</span></h1><p>Your badminton plans, all in one place.<br />Made for the people who make the game.</p></div>
      <div className="court-graphic" aria-hidden="true"><div className="court-boundary"><i className="court-sideline left" /><i className="court-sideline right" /><i className="court-service top" /><i className="court-service bottom" /><i className="court-net" /><i className="court-center top" /><i className="court-center bottom" /><span className="court-shuttle" /></div></div>
      <p className="panel-footer">The next game starts with us.<span>Club member portal</span></p>
    </aside>
    <div className="auth-main"><header className="mobile-brand"><Brand /></header><main id="main-content" className="auth-content" tabIndex={-1}>{children}</main><footer className="auth-footer"><LockKeyhole size={14} aria-hidden="true" /> Private club. Shared love of the game.</footer></div>
  </div>
}

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const registering = mode === 'register'
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const auth = useAuth()

  if (auth.authenticated) return <Navigate to="/app" replace />

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const data = new FormData(event.currentTarget)
    setBusy(true); setError(null)
    try {
      if (registering) await register(String(data.get('display_name')), String(data.get('phone')), String(data.get('password')))
      else await login(String(data.get('phone')), String(data.get('password')))
      navigate('/app', { replace: true })
    } catch (cause) {
      setError(cause instanceof Error && !cause.message.toLowerCase().includes('fetch') ? cause.message : 'We couldn’t connect. Check your connection and try again.')
    } finally { setBusy(false) }
  }

  return <AuthLayout><div className="form-intro"><h2>{registering ? 'Join the club.' : 'Good to see you.'}</h2><p>{registering ? 'A few details, then we’ll see you on court.' : 'Log in to your BJBC account.'}</p></div>
    <ConnectionNotice />
    <form onSubmit={submit} className="auth-form" aria-busy={busy}>
      {registering && <div className="field"><label htmlFor="display_name">Name or nickname</label><input id="display_name" name="display_name" autoComplete="nickname" placeholder="What should we call you?" required maxLength={80} /><p className="field-hint">This is the name other players will see.</p></div>}
      <div className="field"><label htmlFor="phone">Phone number</label><input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="e.g. 012 345 6789" aria-describedby="phone-hint" required maxLength={40} /><p id="phone-hint" className="field-hint">Malaysian number, or include your country code.</p></div>
      <div className="field"><div className="label-row"><label htmlFor="password">Password</label>{!registering && <Link to="/recovery">Forgot password?</Link>}</div><div className="password-field"><input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={registering ? 'new-password' : 'current-password'} placeholder={registering ? 'At least 12 characters' : 'Enter your password'} minLength={registering ? 12 : undefined} required aria-describedby={registering ? 'password-hint' : undefined} /><button type="button" className="password-toggle" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button></div>{registering && <p id="password-hint" className="field-hint">Use at least 12 characters. A memorable phrase works well.</p>}</div>
      {registering && <label className="policy"><input type="checkbox" required name="acknowledgement" /><span>I understand that an admin must approve my membership before I can join sessions, and that session cancellation charges apply.</span></label>}
      {error && <div className="notice error" role="alert"><CircleAlert size={19} aria-hidden="true" /><p>{error}</p></div>}
      <button type="submit" className="button primary w-full" disabled={busy || !supabase}>{busy ? (registering ? 'Creating account…' : 'Logging in…') : (registering ? 'Create account' : 'Log in')}<ArrowRight size={19} aria-hidden="true" /></button>
    </form>
    {registering && <div className="approval-note"><ShieldCheck size={19} aria-hidden="true" /><p>Admin approval keeps our club familiar. We’ll show your membership status after you register.</p></div>}
    <p className="switch-auth">{registering ? 'Already part of BJBC?' : 'New to the club?'} <Link to={registering ? '/login' : '/register'}>{registering ? 'Log in' : 'Create an account'}<ArrowUpRight size={15} aria-hidden="true" /></Link></p>
  </AuthLayout>
}

const states = {
  pending: { title: 'You’re on the list.', description: 'Your account is ready. A club admin needs to approve your membership before you can vote or join a session.', label: 'Awaiting approval' },
  rejected: { title: 'Membership not approved', description: 'Your membership request was not approved. Speak with a BJBC admin if you think this needs another look.', label: 'Not approved' },
  suspended: { title: 'Membership suspended', description: 'You cannot vote or join sessions while your membership is suspended. Your existing payment obligations remain accessible when the payment area is available. Contact a club admin for help.', label: 'Suspended' },
} as const

export function AccountStatusPage() {
  const { membership, refresh, logout, loading, error } = useAuth()
  const [checking, setChecking] = useState(false)
  if (!membership) return null
  if (membership.status === 'active') return <Navigate to="/app" replace />
  const info = states[membership.status as keyof typeof states] ?? states.pending
  return <AuthLayout><div className="status-symbol"><Clock3 size={28} aria-hidden="true" /></div><span className="status-tag">{info.label}</span><div className="form-intro"><h2>{info.title}</h2><p>{info.description}</p></div><dl className="account-summary"><div><dt>Name</dt><dd>{membership.display_name}</dd></div><div><dt>Phone</dt><dd>{membership.phone}</dd></div></dl><p className="field-hint mb-6">Need help? Contact the BJBC admin who invited you to the club.</p>{error && <p role="alert" className="error-copy">{error}</p>}<button className="button primary w-full" disabled={checking || loading} onClick={async () => { setChecking(true); try { await refresh() } finally { setChecking(false) } }}>{checking ? 'Checking…' : 'Check membership status'}<ArrowRight size={18} aria-hidden="true" /></button><button className="button text w-full mt-3" onClick={() => void logout()}><LogOut size={17} aria-hidden="true" />Log out</button></AuthLayout>
}

export function RecoveryPage() {
  return <AuthLayout><div className="status-symbol"><LockKeyhole size={28} aria-hidden="true" /></div><div className="form-intro"><h2>Let’s get you back in.</h2><p>Contact the BJBC admin who invited you. They’ll verify your identity before helping you recover your account.</p></div><div className="notice"><ShieldCheck size={20} aria-hidden="true" /><p>Never share your password. BJBC admins will not ask you to tell them your password.</p></div><p className="field-hint mt-5">Admin-assisted reset links will be introduced in the account recovery phase.</p><Link className="button primary w-full mt-8" to="/login">Back to login<ArrowRight size={18} aria-hidden="true" /></Link></AuthLayout>
}

export function MemberHome() {
  const { membership } = useAuth()
  return <><div className="member-heading"><span className="status-tag"><Check size={14} aria-hidden="true" />Active member</span><h1>Welcome back, {membership?.display_name}.</h1><p>Your BJBC account is ready.</p></div><section className="foundation-empty"><div className="empty-court" aria-hidden="true" /><h2>Your club starts here.</h2><p>Sessions, player lists and payments are coming in the next development phases. There are no sessions to show yet.</p><Link to="/app/profile" className="button primary">Your profile<ArrowRight size={18} aria-hidden="true" /></Link></section></>
}

export function ProfilePage() {
  const { membership, refresh } = useAuth()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const value = String(new FormData(event.currentTarget).get('display_name'))
    setBusy(true); setMessage(null); setError(null)
    try { await updateDisplayName(value); setMessage('Your name has been updated.'); await refresh() }
    catch { setError('Unable to save your name. Check your connection and try again.') }
    finally { setBusy(false) }
  }
  return <div className="profile-page"><Link to="/app" className="back-link">Back to your club</Link><h1>Your profile</h1><p className="text-muted">The name your club knows you by.</p><form onSubmit={submit} className="auth-form mt-8"><div className="field"><label htmlFor="profile-name">Name or nickname</label><input id="profile-name" name="display_name" defaultValue={membership?.display_name} autoComplete="nickname" required maxLength={80} /></div><div className="field"><label htmlFor="profile-phone">Phone number</label><input id="profile-phone" value={membership?.phone ?? ''} readOnly /><p className="field-hint">Phone changes require admin verification.</p></div>{message && <p role="status">{message}</p>}{error && <p role="alert" className="error-copy">{error}</p>}<button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Save name'}<Check size={18} aria-hidden="true" /></button></form></div>
}

import { afterAll, describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { normalizePhone } from '../../src/features/auth/phone'
import { localSql, sqlLiteral } from '../helpers/local-sql'

// Executed only by the local-only preflight in scripts/run-integration.mjs.
const url = process.env.SUPABASE_TEST_URL!
const key = process.env.SUPABASE_TEST_PUBLISHABLE_KEY!
const secret = process.env.SUPABASE_TEST_SECRET_KEY!
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
const admin = createClient(url, secret, options)
const ids: string[] = []
const password = 'Synthetic-only-test-password-42!'
let counter = Number(String(Date.now()).slice(-7))
function nextPhone() { return `+60112${String(++counter % 10000000).padStart(7, '0')}` }

async function signup(extra: Record<string, string> = {}) {
  const phone = nextPhone()
  expect(normalizePhone(phone), 'synthetic fixtures must pass the real phone parser').toBe(phone)
  const client = createClient(url, key, options)
  const result = await client.auth.signUp({ phone, password, options: { data: { display_name: 'Synthetic test member', ...extra } } })
  // Track identities before assertions, so a partially successful signup is cleaned up.
  if (result.data.user?.id) ids.push(result.data.user.id)
  expect(result.error?.code, 'phone signup must work with SMS confirmations disabled').toBeUndefined()
  expect(result.data.session?.access_token, 'SMS-disabled signup must return a session').toBeTruthy()
  expect(result.data.user?.id).toBeTruthy()
  const id = result.data.user!.id
  return { client, phone, id }
}

afterAll(async () => {
  if (ids.length) localSql(`delete from app_private.identity_events where target_user_id in (${ids.map(sqlLiteral).join(',')});`)
  for (const id of new Set(ids)) expect((await admin.auth.admin.deleteUser(id)).error?.code, 'synthetic Auth cleanup').toBeUndefined()
})

describe('real local Supabase Auth', () => {
  it('registers pending/member and ignores forged role/status metadata', async () => {
    const { client } = await signup({ display_name: 'Bear', role: 'admin', status: 'active' })
    const membership = await client.rpc('get_my_membership')
    expect(membership.error?.code).toBeUndefined()
    expect(membership.data?.[0]?.role).toBe('member')
    expect(membership.data?.[0]?.status).toBe('pending')
    expect(membership.data?.[0]?.display_name).toBe('Bear')
    const guard = await client.rpc('assert_active_membership')
    expect(guard.error?.message).toBe('MEMBERSHIP_NOT_ACTIVE')
  })
  it('rejects a duplicate canonical phone after client normalization', async () => {
    const { phone } = await signup()
    const other = createClient(url, key, options)
    const duplicate = await other.auth.signUp({ phone: normalizePhone(`0${phone.slice(3)}`), password, options: { data: { display_name: 'Duplicate' } } })
    // Auth may deliberately obfuscate duplicates. In either case no second identity may exist.
    // Only delete actual fixture identities. Obfuscated duplicate responses may
    // contain invented IDs; they are not proof that an Auth user was created.
    expect(duplicate.error?.code).toBe('user_already_exists')
    const rows = await admin.from('profiles').select('id').eq('phone', phone)
    expect(rows.data?.length).toBe(1)
  })
  it('keeps pending accounts limited to their own identity through PostgREST', async () => {
    const first = await signup()
    const second = await signup()
    const profiles = await first.client.from('profiles').select('id')
    expect(profiles.error?.code).toBeUndefined()
    expect(profiles.data).toEqual([{ id: first.id }])
    const other = await first.client.from('memberships').select('user_id').eq('user_id', second.id)
    expect(other.data).toEqual([])
    expect((await first.client.rpc('update_my_display_name', { display_name_input: 'Forbidden edit' })).error?.message).toBe('MEMBERSHIP_NOT_ACTIVE')
  })
  it('suspension removes active privileges while preserving own account status', async () => {
    const { client, id } = await signup()
    expect((await admin.from('memberships').update({ status: 'active' }).eq('user_id', id)).error?.code).toBeUndefined()
    expect((await client.rpc('assert_active_membership')).data).toBe(id)
    expect((await admin.from('memberships').update({ status: 'suspended' }).eq('user_id', id)).error?.code).toBeUndefined()
    expect((await client.rpc('assert_active_membership')).error?.message).toBe('MEMBERSHIP_NOT_ACTIVE')
    expect((await client.rpc('update_my_display_name', { display_name_input: 'Forbidden edit' })).error?.message).toBe('MEMBERSHIP_NOT_ACTIVE')
    expect((await client.rpc('get_my_membership')).data?.[0]?.status).toBe('suspended')
  })
  it('denies direct role escalation and logs in an approved member with phone/password', async () => {
    const { client, phone, id } = await signup()
    const escalated = await client.from('memberships').update({ role: 'admin', status: 'active' }).eq('user_id', id)
    expect(escalated.error?.code).toBe('42501')
    const approved = await admin.from('memberships').update({ status: 'active', approved_at: new Date().toISOString() }).eq('user_id', id)
    expect(approved.error?.code).toBeUndefined()
    await client.auth.signOut()
    expect((await client.auth.signInWithPassword({ phone, password })).error?.code).toBeUndefined()
    expect((await client.rpc('assert_active_membership')).data).toBe(id)
    await client.auth.signOut()
    expect((await client.auth.getSession()).data.session).toBeNull()
  })
  it('cannot bypass phone-change verification through the Auth API', async () => {
    const { client, id, phone } = await signup()
    const replacement = nextPhone()
    const changed = await client.auth.updateUser({ phone: replacement })
    expect(changed.error).toBeTruthy()
    expect((await admin.auth.admin.getUserById(id)).data.user?.phone).toBe(phone.slice(1))
    expect(() => localSql(`update auth.users set phone=${sqlLiteral(replacement.slice(1))} where id=${sqlLiteral(id)};`)).toThrow('PHONE_CHANGE_REQUIRES_ADMIN_VERIFICATION')
  })
  it('rejects invalid credentials without an authenticated session', async () => {
    const { phone } = await signup()
    const client = createClient(url, key, options)
    const result = await client.auth.signInWithPassword({ phone, password: 'definitely-wrong-password' })
    expect(result.error?.code).toBe('invalid_credentials')
    expect(result.data.session).toBeNull()
  })
  it('refreshes a live Auth session and rejects its refresh token after logout', async () => {
    const { client } = await signup()
    const renewed = await client.auth.refreshSession()
    expect(renewed.error?.code).toBeUndefined()
    const refreshToken = renewed.data.session!.refresh_token
    expect((await client.auth.getUser()).error?.code).toBeUndefined()
    expect((await client.auth.signOut()).error?.code).toBeUndefined()
    const newClient = createClient(url, key, options)
    const replay = await newClient.auth.refreshSession({ refresh_token: refreshToken })
    expect(replay.error).toBeTruthy()
    expect(replay.data.session).toBeNull()
  })
  it('PostgREST accepts a valid signed local JWT and rejects the same identity after expiry', async () => {
    const { id } = await signup()
    const jwtSecret = process.env.SUPABASE_TEST_JWT_SECRET
    if (!jwtSecret) throw new Error('Local JWT signing fixture is missing; no signing material is printed.')
    function signedToken(expires: number) {
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
      const payload = Buffer.from(JSON.stringify({ sub: id, role: 'authenticated', aud: 'authenticated', iss: `${url}/auth/v1`, iat: Math.floor(Date.now() / 1000) - 120, exp: expires })).toString('base64url')
      const body = `${header}.${payload}`
      return `${body}.${createHmac('sha256', jwtSecret!).update(body).digest('base64url')}`
    }
    async function request(expires: number) {
      return fetch(`${url}/rest/v1/rpc/get_my_membership`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${signedToken(expires)}`, 'Content-Type': 'application/json' }, body: '{}' })
    }
    expect((await request(Math.floor(Date.now() / 1000) + 300)).status).toBe(200)
    const expired = await request(Math.floor(Date.now() / 1000) - 120)
    expect(expired.status).toBe(401)
    const error = await expired.json()
    expect(error.code).toBe('PGRST303')
    expect(error.message).toMatch(/expired/i)
  })
  it('rejects SMS delivery in the live Auth API and the actual database hook', async () => {
    const { client, phone } = await signup()
    const attempt = await client.auth.signInWithOtp({ phone, options: { shouldCreateUser: false } })
    // Custom PostgreSQL hook errors have HTTP status/message rather than a
    // built-in Auth error_code. Assert our hook response, not a quota error.
    expect(attempt.error?.status).toBe(403)
    expect(attempt.error?.message).toBe('SMS authentication is disabled for BJBC.')
    expect(attempt.data.session).toBeNull()
    // Supabase's postgres operator cannot SET ROLE supabase_auth_admin. Inspect
    // the real grants, then invoke the pure rejecting hook as the trusted operator.
    expect(localSql("select has_schema_privilege('supabase_auth_admin','app_private','USAGE') and has_function_privilege('supabase_auth_admin','app_private.reject_sms_delivery(jsonb)','EXECUTE');")).toBe('t')
    const hook = localSql("select app_private.reject_sms_delivery('{}'::jsonb)::text;")
    expect(JSON.parse(hook)).toEqual({ error: { http_code: 403, message: 'SMS authentication is disabled for BJBC.' } })
  })
  it('bootstraps one synthetic first admin through trusted SQL and records the operation', async () => {
    expect(localSql("select count(*) from public.memberships where role='admin';"), 'do not bootstrap over an existing admin').toBe('0')
    const { client, phone, id } = await signup()
    expect(localSql(`select app_private.bootstrap_first_admin(${sqlLiteral(phone)});`)).toBe(id)
    const membership = await client.rpc('get_my_membership')
    expect(membership.data?.[0]?.role).toBe('admin')
    expect(membership.data?.[0]?.status).toBe('active')
    expect(localSql(`select count(*) from app_private.identity_events where target_user_id=${sqlLiteral(id)} and action='bootstrap_first_admin';`)).toBe('1')
    expect(() => localSql(`select app_private.bootstrap_first_admin(${sqlLiteral(phone)});`)).toThrow('ADMIN_ALREADY_EXISTS')
    const denied = await client.schema('app_private').rpc('bootstrap_first_admin', { target_phone: phone })
    expect(denied.error?.code).toBe('PGRST106')
  })
})

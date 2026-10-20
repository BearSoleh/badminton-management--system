import { afterAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { normalizePhone } from '../../src/features/auth/phone'

// Executed only by the local-only preflight in scripts/run-integration.mjs.
const url = process.env.SUPABASE_TEST_URL!
const key = process.env.SUPABASE_TEST_PUBLISHABLE_KEY!
const secret = process.env.SUPABASE_TEST_SECRET_KEY!
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
const admin = createClient(url, secret, options)
const ids: string[] = []
const password = 'Synthetic-only-test-password-42!'
let counter = Number(String(Date.now()).slice(-7))

async function signup(extra: Record<string, string> = {}) {
  const phone = `+6011${String(++counter).padStart(8, '0')}`
  const client = createClient(url, key, options)
  const result = await client.auth.signUp({ phone, password, options: { data: { display_name: 'Synthetic test member', ...extra } } })
  expect(result.error?.code, 'phone signup must work with SMS confirmations disabled').toBeUndefined()
  expect(result.data.session?.access_token, 'SMS-disabled signup must return a session').toBeTruthy()
  expect(result.data.user?.id).toBeTruthy()
  const id = result.data.user!.id
  ids.push(id)
  return { client, phone, id }
}

afterAll(async () => {
  for (const id of ids) await admin.auth.admin.deleteUser(id)
})

describe('real local Supabase Auth', () => {
  it('registers pending/member and ignores forged role/status metadata', async () => {
    const { client } = await signup({ role: 'admin', status: 'active' })
    const membership = await client.rpc('get_my_membership')
    expect(membership.error?.code).toBeUndefined()
    expect(membership.data?.[0]?.role).toBe('member')
    expect(membership.data?.[0]?.status).toBe('pending')
    const guard = await client.rpc('assert_active_membership')
    expect(guard.error?.message).toBe('MEMBERSHIP_NOT_ACTIVE')
  })
  it('rejects a duplicate canonical phone after client normalization', async () => {
    const { phone } = await signup()
    const other = createClient(url, key, options)
    const duplicate = await other.auth.signUp({ phone: normalizePhone(`0${phone.slice(3)}`), password, options: { data: { display_name: 'Duplicate' } } })
    // Auth may deliberately obfuscate duplicates. In either case no second identity may exist.
    if (duplicate.data.user?.id && !ids.includes(duplicate.data.user.id)) ids.push(duplicate.data.user.id)
    const rows = await admin.from('profiles').select('id').eq('phone', phone)
    expect(rows.data?.length).toBe(1)
  })
  it('denies direct role escalation and logs in an approved member with phone/password', async () => {
    const { client, phone, id } = await signup()
    const escalated = await client.from('memberships').update({ role: 'admin', status: 'active' }).eq('user_id', id)
    expect(escalated.error).toBeTruthy()
    const approved = await admin.from('memberships').update({ status: 'active', approved_at: new Date().toISOString() }).eq('user_id', id)
    expect(approved.error?.code).toBeUndefined()
    await client.auth.signOut()
    expect((await client.auth.signInWithPassword({ phone, password })).error?.code).toBeUndefined()
    expect((await client.rpc('assert_active_membership')).data).toBe(id)
    await client.auth.signOut()
    expect((await client.auth.getSession()).data.session).toBeNull()
  })
  it('cannot bypass phone-change verification through the Auth API', async () => {
    const { client } = await signup()
    const changed = await client.auth.updateUser({ phone: `+6011${String(++counter).padStart(8, '0')}` })
    expect(changed.error).toBeTruthy()
  })
  it('rejects invalid credentials without an authenticated session', async () => {
    const { phone } = await signup()
    const client = createClient(url, key, options)
    const result = await client.auth.signInWithPassword({ phone, password: 'definitely-wrong-password' })
    expect(result.error).toBeTruthy()
    expect(result.data.session).toBeNull()
  })
})

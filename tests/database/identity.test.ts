import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createIdentityDatabase } from '../helpers/identity-db.mjs'
import type { PGlite } from '@electric-sql/pglite'

const userA = '00000000-0000-4000-8000-000000000001'
const userB = '00000000-0000-4000-8000-000000000002'
let db: PGlite
async function signup(id = userA, phone = '60123456789', metadata: object = { display_name: 'Bear' }) {
  return db.query('insert into auth.users (id, phone, raw_user_meta_data) values ($1,$2,$3)', [id, phone, JSON.stringify(metadata)])
}
async function actor<T>(id: string, action: () => Promise<T>) {
  await db.exec('set role authenticated')
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id])
  try { return await action() } finally { await db.exec('reset role') }
}

describe('identity migration on PostgreSQL', () => {
  beforeAll(async () => { db = await createIdentityDatabase() })
  afterAll(async () => { await db.close() })
  beforeEach(async () => {
    // A missing migration is deliberately observable as a failing table assertion.
    const exists = await db.query<{ exists: boolean }>("select to_regclass('public.memberships') is not null as exists")
    expect(exists.rows[0].exists, 'identity migration must create memberships').toBe(true)
    await db.exec('delete from app_private.identity_events; delete from public.memberships; delete from public.profiles; delete from auth.users;')
  })
  it('ignores forged admin/approval metadata and creates a pending member', async () => {
    await signup(userA, '60123456789', { display_name: 'Bear', role: 'admin', status: 'active' })
    const result = await actor(userA, () => db.query('select role,status from public.memberships'))
    expect(result.rows).toEqual([{ role: 'member', status: 'pending' }])
  })
  it('stores canonical phone and trimmed display name', async () => {
    await signup(userA, '60123456789', { display_name: ' Bear ' })
    expect((await actor(userA, () => db.query('select phone,display_name from public.profiles'))).rows)
      .toEqual([{ phone: '+60123456789', display_name: 'Bear' }])
  })
  it('rejects duplicate canonical phones even with a leading plus alias', async () => {
    await signup()
    await expect(signup(userB, '+60123456789')).rejects.toThrow(/unique/i)
  })
  it.each(['0123456789', '0060123456789', 'bad-phone'])('rejects noncanonical Auth phone %s', async (phone) => {
    await expect(signup(userA, phone)).rejects.toThrow(/phone/i)
  })
  it('rejects phone-less accounts and blank display names', async () => {
    await expect(db.query('insert into auth.users(id,raw_user_meta_data) values ($1,$2)', [userA, { display_name: 'Bear' }])).rejects.toThrow(/phone/i)
    await expect(signup(userA, '60123456789', { display_name: ' ' })).rejects.toThrow(/display name/i)
  })
  it('denies pending and suspended actors at the database membership guard', async () => {
    await signup()
    await expect(actor(userA, () => db.query('select public.assert_active_membership()'))).rejects.toThrow('MEMBERSHIP_NOT_ACTIVE')
    await db.query("update public.memberships set status='suspended' where user_id=$1", [userA])
    await expect(actor(userA, () => db.query('select public.assert_active_membership()'))).rejects.toThrow('MEMBERSHIP_NOT_ACTIVE')
  })
  it('admits an approved active member at the same database guard', async () => {
    await signup()
    await db.query("update public.memberships set status='active' where user_id=$1", [userA])
    expect((await actor(userA, () => db.query('select public.assert_active_membership() as id'))).rows).toEqual([{ id: userA }])
  })
  it('does not allow a member to promote or approve themselves', async () => {
    await signup()
    await expect(actor(userA, () => db.query("update public.memberships set role='admin',status='active'"))).rejects.toThrow(/permission denied/i)
    await expect(actor(userA, () => db.query("insert into public.memberships(user_id,role,status) values ($1,'admin','active')", [userB]))).rejects.toThrow(/permission denied/i)
  })
  it('hides another member profile and membership', async () => {
    await signup(); await signup(userB, '60139876543', { display_name: 'Other' })
    expect((await actor(userA, () => db.query('select id from public.profiles'))).rows).toEqual([{ id: userA }])
    expect((await actor(userA, () => db.query('select user_id from public.memberships'))).rows).toEqual([{ user_id: userA }])
  })
  it('allows only own display-name update through a validated RPC', async () => {
    await signup()
    await db.query("update public.memberships set status='active' where user_id=$1", [userA])
    await actor(userA, () => db.query("select public.update_my_display_name(' New nickname ')"))
    expect((await actor(userA, () => db.query('select display_name from public.get_my_membership()'))).rows).toEqual([{ display_name: 'New nickname' }])
    await expect(actor(userA, () => db.query("update public.profiles set phone='+60139876543'"))).rejects.toThrow(/permission denied/i)
    await expect(actor(userA, () => db.query("select public.update_my_display_name(' ')"))).rejects.toThrow(/display name/i)
  })
  it('blocks credential phone mutation so it cannot diverge from the profile identity', async () => {
    await signup()
    await expect(db.query('update auth.users set phone=$1 where id=$2', ['60139876543', userA])).rejects.toThrow('PHONE_CHANGE_REQUIRES_ADMIN_VERIFICATION')
  })
  it('denies anonymous identity access and guarded participation', async () => {
    await signup(); await db.exec('set role anon')
    try {
      await expect(db.query('select * from public.profiles')).rejects.toThrow(/permission denied/i)
      await expect(db.query('select public.assert_active_membership()')).rejects.toThrow(/permission denied/i)
    } finally { await db.exec('reset role') }
  })
  it('bootstraps exactly one trusted first admin with an audit event', async () => {
    await signup()
    await expect(actor(userA, () => db.query("select app_private.bootstrap_first_admin('+60123456789')"))).rejects.toThrow(/permission denied/i)
    await db.query("select app_private.bootstrap_first_admin('+60123456789')")
    expect((await db.query('select role,status from public.memberships')).rows).toEqual([{ role: 'admin', status: 'active' }])
    expect((await db.query('select action from app_private.identity_events')).rows).toEqual([{ action: 'bootstrap_first_admin' }])
    await expect(db.query("select app_private.bootstrap_first_admin('+60123456789')")).rejects.toThrow('ADMIN_ALREADY_EXISTS')
  })
  it('rejects every SMS delivery request without exposing event data', async () => {
    await db.exec('set role supabase_auth_admin')
    try {
      const result = await db.query<{ result: unknown }>("select app_private.reject_sms_delivery($1) as result", [{ user: { phone: 'synthetic-only' }, sms: { otp: 'not-logged' } }])
      expect(result.rows[0].result).toEqual({ error: { http_code: 403, message: 'SMS authentication is disabled for BJBC.' } })
    } finally { await db.exec('reset role') }
  })
  it('denies pending profile editing at the database, even through the RPC', async () => {
    await signup()
    await expect(actor(userA, () => db.query("select public.update_my_display_name('Another name')"))).rejects.toThrow('MEMBERSHIP_NOT_ACTIVE')
  })
})

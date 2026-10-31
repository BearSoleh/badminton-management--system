import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createIdentityDatabase } from '../helpers/identity-db.mjs'
import { coreFixtureSql, fixtureId as id } from '../helpers/core-fixture'

let db: PGlite
const users = { a: id(101), b: id(102), pending: id(103), suspended: id(104), admin: id(105) }
async function actor<T>(user: string | null, work: () => Promise<T>) {
  await db.exec(user ? 'set role authenticated' : 'set role anon')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ''])
  try { return await work() } finally { await db.exec('reset role') }
}
async function rows(user: string | null, sql: string) { return (await actor(user, () => db.query<Record<string, unknown>>(sql))).rows }

describe('core PostgreSQL permissions and constraints', () => {
  beforeAll(async () => {
    db = await createIdentityDatabase()
    expect((await db.query("select to_regclass('public.charges') is not null as exists")).rows[0]).toEqual({ exists: true })
    let n = 0
    for (const [label, uid] of Object.entries(users)) await db.query('insert into auth.users(id,phone,raw_user_meta_data) values($1,$2,$3)', [uid, `60112345678${n++}`, { display_name: `Synthetic ${label}` }])
    await db.exec(coreFixtureSql(users))
  })
  afterAll(async () => { await db?.close() })

  it('enables RLS on every public application table', async () => {
    expect((await db.query("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity")).rows).toEqual([])
  })
  it.each([null, users.pending, users.suspended, id(999)])('hides sessions and roster from ineligible actor %s', async (uid) => {
    if (!uid) { await expect(rows(null, 'select * from public.sessions')).rejects.toThrow(/permission denied/); return }
    expect(await rows(uid, 'select id from public.sessions')).toEqual([])
    expect(await rows(uid, `select * from public.get_session_roster('${id(20)}')`)).toEqual([])
  })
  it('active members see published sessions but never drafts', async () => {
    expect(await rows(users.a, 'select id from public.sessions')).toEqual([{ id: id(20) }])
    expect(await rows(users.a, `select * from public.get_session_roster('${id(21)}')`)).toEqual([])
    expect((await rows(users.admin, 'select id from public.sessions')).length).toBe(2)
  })
  it('projects only display names/states without underlying foreign identities', async () => {
    const roster = await rows(users.a, `select * from public.get_session_roster('${id(20)}')`)
    expect(roster).toHaveLength(4)
    expect(Object.keys(roster[0]).sort()).toEqual(['session_id', 'participant_id', 'display_name', 'participation_status', 'attendance'].sort())
    expect((await rows(users.a, 'select id from public.profiles'))).toEqual([{ id: users.a }])
    expect((await rows(users.a, 'select id from public.participants'))).toEqual([{ id: id(31) }])
    expect((await rows(users.a, 'select * from public.guests'))).toEqual([])
  })
  it('members and suspended members see only their own obligations', async () => {
    expect(await rows(users.a, 'select id from public.charges')).toEqual([{ id: id(51) }])
    expect(await rows(users.suspended, 'select id from public.charges')).toEqual([{ id: id(53) }])
    expect(await rows(users.suspended, 'select id from public.fee_versions')).toEqual([{ id: id(40) }])
    expect(await rows(users.a, 'select * from public.payments')).toEqual([])
    expect(await rows(users.b, 'select id from public.payments')).toEqual([{ id: id(60) }])
    expect(await rows(users.pending, 'select * from public.charges')).toEqual([])
  })
  it('admin reads club records but cannot directly mutate privileged fields', async () => {
    expect((await rows(users.admin, 'select id from public.charges'))).toHaveLength(3)
    expect((await rows(users.admin, 'select id from public.guests'))).toHaveLength(1)
    for (const uid of [users.a, users.admin]) {
      for (const sql of ["update public.memberships set role='admin'", "update public.profiles set phone='+60123456789'", "update public.payments set status='approved'", "update public.charges set status='paid'", "delete from public.audit_logs"]) {
        await expect(rows(uid, sql)).rejects.toThrow(/permission denied/)
      }
    }
  })
  it('suspending an admin immediately removes broad read privileges', async () => {
    await db.query("update public.memberships set status='suspended' where user_id=$1", [users.admin])
    try { expect(await rows(users.admin, 'select id from public.audit_logs')).toEqual([]); expect(await rows(users.admin, 'select id from public.charges')).toEqual([]) }
    finally { await db.query("update public.memberships set status='active' where user_id=$1", [users.admin]) }
  })
  it('notifications are own only and private token/outbox tables are inaccessible', async () => {
    expect(await rows(users.a, 'select id from public.notifications')).toEqual([{ id: id(80) }])
    expect(await rows(users.a, 'select * from public.audit_logs')).toEqual([])
    for (const name of ['guest_access_tokens', 'recovery_tokens', 'notification_outbox']) {
      await expect(rows(users.admin, `select * from app_private.${name}`)).rejects.toThrow(/permission denied/)
    }
  })
  it('rejects unknown identity sources, invalid time ranges, capacity and negative money', async () => {
    await expect(db.query('insert into public.players default values')).rejects.toThrow(/check constraint/)
    await expect(db.query("update public.sessions set capacity=0 where id=$1", [id(20)])).rejects.toThrow(/check constraint/)
    await expect(db.query('update public.sessions set ends_at=starts_at where id=$1', [id(20)])).rejects.toThrow(/check constraint/)
    await expect(db.query('insert into public.fee_versions(session_id,full_fee_sen,version,published_by) values($1,-1,1,$2)', [id(21),users.admin])).rejects.toThrow(/check constraint/)
    await expect(db.query('insert into public.charges(participant_id,session_id,fee_version_id,percent,amount_sen,is_current) values($1,$2,$3,50,2000,false)', [id(31),id(20),id(40)])).rejects.toThrow(/check constraint/)
  })
  it('prevents mismatched session billing and duplicate current/pending liabilities', async () => {
    await expect(db.query('insert into public.charges(participant_id,session_id,fee_version_id,percent,amount_sen,is_current) values($1,$2,$3,100,2000,false)', [id(31),id(21),id(40)])).rejects.toThrow(/foreign key/)
    await expect(db.query("insert into public.charges(participant_id,session_id,fee_version_id,percent,amount_sen) values($1,$2,$3,100,2000)", [id(31), id(20), id(40)])).rejects.toThrow(/unique/)
    await expect(db.query("insert into public.payments(charge_id,method,amount_sen,receipt_object_path,submitted_by,idempotency_key) values($1,'transfer',2000,'fixture.pdf',$2,$3)", [id(52), users.b, id(62)])).rejects.toThrow(/unique/)
    await expect(db.query('delete from public.sessions where id=$1', [id(20)])).rejects.toThrow(/foreign key/)
    await expect(db.query('delete from public.profiles where id=$1', [users.a])).rejects.toThrow(/foreign key/)
  })
  it('keeps exactly 15-minute offers and only one pending offer per participant', async () => {
    await expect(db.query("insert into public.waitlist_offers(participant_id,offered_at,expires_at) values($1,now(),now()+interval '16 minutes')", [id(34)])).rejects.toThrow(/check constraint/)
    await db.query("insert into public.waitlist_offers(participant_id,offered_at,expires_at) values($1,now(),now()+interval '15 minutes')", [id(34)])
    await expect(db.query("insert into public.waitlist_offers(participant_id,offered_at,expires_at) values($1,now(),now()+interval '15 minutes')", [id(34)])).rejects.toThrow(/unique/)
  })
  it('stores hashed capabilities, fixes KL/MYR settings and keeps WhatsApp disabled', async () => {
    await expect(db.query("insert into app_private.guest_access_tokens(guest_id,session_id,token_hash,expires_at,scope) values($1,$2,'raw-private-link',now()+interval '30 days','session_payment')", [id(1), id(20)])).rejects.toThrow(/check constraint/)
    await expect(db.query("insert into app_private.notification_outbox(event_key,channel) values('fixture','whatsapp')")).rejects.toThrow(/check constraint/)
    await expect(db.query("insert into public.club_settings(timezone) values('UTC')")).rejects.toThrow(/check constraint/)
    await expect(db.query("insert into public.club_settings(currency) values('USD')")).rejects.toThrow(/check constraint/)
    await db.query('insert into public.club_settings default values')
    expect((await db.query('select timezone,currency from public.club_settings')).rows).toEqual([{ timezone: 'Asia/Kuala_Lumpur', currency: 'MYR' }])
  })
  it('audit records are append-only even for the backend service role', async () => {
    await db.exec('set role service_role')
    try { await expect(db.query("update public.audit_logs set action='tamper'")).rejects.toThrow(/permission denied|APPEND_ONLY/); await expect(db.query('delete from public.audit_logs')).rejects.toThrow(/permission denied|APPEND_ONLY/) }
    finally { await db.exec('reset role') }
  })
  it('binds receipt upload paths to a current own obligation and denies all client signing', async () => {
    const own = `${users.a}/${id(51)}/${id(71)}.pdf`
    await actor(users.a, () => db.query("insert into storage.objects(bucket_id,name,owner_id) values('receipts',$1,$2)", [own, users.a]))
    expect(await rows(users.a, 'select * from storage.objects')).toEqual([])
    expect(await rows(users.admin, 'select * from storage.objects')).toEqual([])
    expect(await rows(users.a, `select public.authorize_receipt_view('${own}') as path`)).toEqual([{ path: own }])
    for (const uid of [users.b, users.pending, users.suspended, id(999)]) await expect(rows(uid, `select public.authorize_receipt_view('${own}')`)).rejects.toThrow('RECEIPT_ACCESS_DENIED')
    await expect(actor(users.a, () => db.query("insert into storage.objects(bucket_id,name,owner_id) values('receipts',$1,$2)", [`${users.a}/${id(52)}/${id(72)}.pdf`, users.a]))).rejects.toThrow(/row-level security/)
    await expect(actor(users.a, () => db.query("insert into storage.objects(bucket_id,name,owner_id) values('receipts',$1,$2)", [`${users.b}/${id(51)}/${id(73)}.svg`, users.a]))).rejects.toThrow(/row-level security/)
  })
})

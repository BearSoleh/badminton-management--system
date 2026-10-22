import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createIdentityDatabase } from '../helpers/identity-db.mjs'
import { randomUUID } from 'node:crypto'

let db: PGlite
const users = Array.from({ length: 5 }, () => randomUUID())
const [admin, a, b, c, pending] = users
async function call(uid: string, sql: string, args: unknown[] = []) {
  await db.exec('savepoint actor_call')
  try {
    await db.exec('set role authenticated')
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid])
    const result = await db.query<{ result: Record<string, unknown> }>(sql, args)
    await db.exec('reset role; release savepoint actor_call')
    return result.rows[0]?.result
  } catch (error) { await db.exec('rollback to savepoint actor_call; reset role; release savepoint actor_call'); throw error }
}
async function session(capacity = 2) {
  const result = await call(admin, "select public.save_session(null,'Synthetic game','Test court',now()+interval '2 days',now()+interval '2 days 2 hours',$1,now()+interval '1 day','automatic',$2) as result", [capacity, randomUUID()])
  const sid = result.session_id as string
  await call(admin, 'select public.publish_session($1,$2) as result', [sid, randomUUID()])
  return sid
}
const vote = (uid: string, sid: string, choice = 'play', request = randomUUID()) => call(uid, 'select public.cast_session_vote($1,$2,$3) as result', [sid, choice, request])
const join = (uid: string, sid: string) => call(uid, 'select public.join_session($1,$2) as result', [sid, randomUUID()])
const withdraw = (uid: string, pid: unknown) => call(uid, 'select public.withdraw_participation($1,$2) as result', [pid, randomUUID()])

describe('transactional participation rules in PostgreSQL', () => {
  beforeAll(async () => {
    db = await createIdentityDatabase()
    expect((await db.query("select to_regprocedure('public.cast_session_vote(uuid,text,uuid)') is not null as exists")).rows[0]).toEqual({ exists: true })
  })
  beforeEach(async () => {
    await db.exec('begin')
    for (const [i, uid] of users.entries()) await db.query('insert into auth.users(id,phone,raw_user_meta_data) values($1,$2,$3)', [uid, `60112345678${i}`, { display_name: `Synthetic ${i}` }])
    await db.query("update public.memberships set status='active' where user_id<>$1", [pending])
    await db.query("update public.memberships set role='admin' where user_id=$1", [admin])
  })
  afterEach(async () => { await db.exec('rollback') })
  afterAll(async () => { await db?.close() })
  it('confirms the first two timestamped votes and queues the third', async () => {
    const sid = await session()
    const one = await vote(a, sid), two = await vote(b, sid), three = await vote(c, sid)
    expect([one.participation_status, two.participation_status, three.participation_status]).toEqual(['confirmed','confirmed','waitlisted'])
    expect(Date.parse(one.queue_joined_at as string)).toBeLessThanOrEqual(Date.parse(two.queue_joined_at as string))
    expect(Date.parse(two.queue_joined_at as string)).toBeLessThanOrEqual(Date.parse(three.queue_joined_at as string))
  })
  it('retries return the original result; new identical votes never move priority', async () => {
    const sid = await session(), request = randomUUID()
    const first = await vote(a, sid, 'play', request)
    expect(await vote(a, sid, 'play', request)).toEqual(first)
    expect(await vote(a, sid)).toEqual(first)
    await expect(vote(a, sid, 'pass', request)).rejects.toThrow('REQUEST_ID_CONFLICT')
    expect((await db.query('select count(*)::int as count from public.participants')).rows[0]).toEqual({ count: 1 })
  })
  it('withdraw/rejoin receives a fresh timestamp behind the waiting queue', async () => {
    const sid = await session(1), first = await vote(a, sid)
    await vote(b, sid)
    await withdraw(a, first.participant_id)
    const rejoined = await vote(a, sid)
    expect(rejoined.participation_status).toBe('waitlisted')
    expect(Date.parse(rejoined.queue_joined_at as string)).toBeGreaterThanOrEqual(Date.parse(first.queue_joined_at as string))
    expect((await db.query("select safe_metadata from public.audit_logs where action='participation_changed' and entity_id=$1 order by created_at", [first.participant_id])).rows).toHaveLength(3)
  })
  it('denies direct joins before close; after close an existing queue keeps priority', async () => {
    const sid = await session(1), first = await vote(a, sid)
    await vote(b, sid)
    await expect(join(c, sid)).rejects.toThrow('VOTING_STILL_OPEN')
    await withdraw(a, first.participant_id)
    await db.query("update public.sessions set voting_closes_at=now()-interval '1 second' where id=$1", [sid])
    expect((await join(c, sid)).participation_status).toBe('waitlisted')
    const queue = await db.query<{ user_id: string }>("select pl.user_id from public.participants p join public.players pl on pl.id=p.player_id where p.session_id=$1 and p.participation_status in ('waitlisted','offered') order by p.queue_joined_at,p.id", [sid])
    expect(queue.rows.map((p) => p.user_id)).toEqual([b,c])
  })
  it('held unexpired offers consume capacity and a play vote cannot accept them', async () => {
    const sid = await session(1), first = await vote(a, sid)
    await db.query("update public.participants set participation_status='offered',charge_percent=0 where id=$1", [first.participant_id])
    await db.query("insert into public.waitlist_offers(participant_id,offered_at,expires_at) values($1,now(),now()+interval '15 minutes')", [first.participant_id])
    const snapshot=await call(a,'select public.get_session_snapshot($1) as result',[sid])
    expect(snapshot.counts).toEqual({confirmed:0,held:1,waiting:0})
    expect((await vote(b, sid)).participation_status).toBe('waitlisted')
    expect((await vote(a, sid)).participation_status).toBe('offered')
    expect((await vote(a, sid, 'pass')).charge_percent).toBe(0)
    expect((await db.query('select state from public.waitlist_offers where participant_id=$1',[first.participant_id])).rows).toEqual([{ state: 'declined' }])
    expect((await db.query("select count(*)::int n from public.waitlist_offers where state='pending'")).rows[0]).toEqual({n:1})
  })
  it('KL calendar midnight determines 0 or 75, independently of 24 hours', async () => {
    const result = await db.query("select app_private.withdrawal_percentage('2026-10-23T20:00:00+08','2026-10-22T23:59:59+08',true) as early, app_private.withdrawal_percentage('2026-10-23T20:00:00+08','2026-10-23T00:00:00+08',true) as late, app_private.withdrawal_percentage('2026-10-23T20:00:00+08','2026-10-23T12:00:00+08',false) as waiting")
    expect(result.rows).toEqual([{ early: 0, late: 75, waiting: 0 }])
  })
  it('late cancellation liability survives rejoin behind someone else', async () => {
    const sid = await session(1), first = await vote(a, sid)
    await vote(b, sid)
    await db.query("update public.sessions set starts_at=clock_timestamp()+interval '2 minutes',ends_at=clock_timestamp()+interval '2 hours',voting_closes_at=clock_timestamp()-interval '1 second' where id=$1", [sid])
    const today = (await db.query<{ same_day: boolean }>("select (clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date=(starts_at at time zone 'Asia/Kuala_Lumpur')::date as same_day from public.sessions where id=$1", [sid])).rows[0].same_day
    const late = await withdraw(a, first.participant_id)
    expect(late.charge_percent).toBe(today ? 75 : 0)
    const rejoined = await join(a, sid)
    expect(rejoined.participation_status).toBe('waitlisted')
    expect(rejoined.liability_percent).toBe(today ? 75 : 0)
    expect(rejoined.charge_percent).toBe(today ? 75 : 0)
  })
  it('pass votes use withdrawal rules and preserve old vote timestamps in audit', async () => {
    const sid = await session(), first = await vote(a, sid)
    expect((await vote(a, sid, 'pass')).participation_status).toBe('withdrawn_early')
    expect((await db.query("select choice,joined_at from public.votes where user_id=$1", [a])).rows).toEqual([{ choice: 'pass', joined_at: null }])
    expect((await db.query("select count(*)::int as count from public.audit_logs where action='vote_changed' and actor_user_id=$1 and safe_metadata::text like $2", [a, `%${String(first.queue_joined_at).slice(0,10)}%`])).rows[0]).toEqual({ count: 2 })
  })
  it('denies pending/suspended actors, foreign withdrawals and caller time/identity forgery', async () => {
    const sid = await session(), first = await vote(a, sid)
    await expect(vote(pending, sid)).rejects.toThrow('MEMBERSHIP_NOT_ACTIVE')
    await db.query("update public.memberships set status='suspended' where user_id=$1", [b])
    await expect(vote(b, sid)).rejects.toThrow('MEMBERSHIP_NOT_ACTIVE')
    await expect(withdraw(c, first.participant_id)).rejects.toThrow('PARTICIPANT_NOT_FOUND')
    await expect(call(a, "select public.save_session(null,'Forged','Court',now()+interval '1 day',now()+interval '2 days',4,now()+interval '1 hour','automatic',$1) as result", [randomUUID()])).rejects.toThrow('ADMIN_REQUIRED')
  })
  it.each(['cancelled','completed','in_progress'])('rejects participation in %s sessions', async (status) => {
    const sid = await session()
    await db.query('update public.sessions set operational_status=$1 where id=$2', [status,sid])
    await expect(vote(a,sid)).rejects.toThrow('SESSION_NOT_JOINABLE')
  })
  it('rejects vote at close and all new joins/withdrawals at or after start', async () => {
    const sid = await session(), first = await vote(a, sid)
    await db.query("update public.sessions set voting_closes_at=clock_timestamp()-interval '1 second' where id=$1", [sid])
    await expect(vote(b,sid)).rejects.toThrow('VOTING_CLOSED')
    await db.query("update public.sessions set starts_at=clock_timestamp()-interval '1 second' where id=$1", [sid])
    await expect(join(b,sid)).rejects.toThrow('SESSION_STARTED')
    await expect(withdraw(a,first.participant_id)).rejects.toThrow('SESSION_STARTED')
  })
  it('published sessions cannot be silently edited or republished', async () => {
    const sid = await session()
    await expect(call(admin,"select public.save_session($1,'Changed','Court',now()+interval '3 days',now()+interval '4 days',1,now()+interval '1 day','manual',$2) as result",[sid,randomUUID()])).rejects.toThrow('DRAFT_REQUIRED')
    await expect(call(admin,'select public.publish_session($1,$2) as result',[sid,randomUUID()])).rejects.toThrow('DRAFT_REQUIRED')
    expect((await db.query('select count(*)::int as count from public.polls where session_id=$1',[sid])).rows[0]).toEqual({ count: 1 })
  })
  it('admins can play as members but cannot invoke private transaction helpers',async()=>{
    const sid=await session()
    expect((await vote(admin,sid)).participation_status).toBe('confirmed')
    await expect(call(admin,"select app_private.begin_operation('forged','{}',$1) as result",[randomUUID()])).rejects.toThrow(/permission denied/)
  })
})

import { randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { localSql, sqlLiteral as q } from '../helpers/local-sql'

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
const url = process.env.SUPABASE_TEST_URL!, key = process.env.SUPABASE_TEST_PUBLISHABLE_KEY!
const operator = createClient(url, process.env.SUPABASE_TEST_SECRET_KEY!, options)
const actors: { uid: string; client: SupabaseClient }[] = []
const sessions: string[] = []
const sidArgs = (sid: string) => ({ session_id_input: sid, request_id: randomUUID() })

async function makeSession(capacity = 2) {
  const now = Date.now(), request = randomUUID()
  const args = { session_id_input: null, title_input: 'Synthetic Task 3 game', venue_input: 'Synthetic court', starts_at_input: new Date(now+172800000).toISOString(), ends_at_input: new Date(now+180000000).toISOString(), voting_closes_at_input: new Date(now+86400000).toISOString(), capacity_input: capacity, waitlist_mode_input: 'automatic', request_id: request }
  const draft = await actors[0].client.rpc('save_session', args)
  expect(draft.error?.code).toBeUndefined()
  const sid = draft.data.session_id as string
  sessions.push(sid)
  expect((await actors[0].client.rpc('save_session', args)).data).toEqual(draft.data)
  expect((await actors[0].client.rpc('publish_session', sidArgs(sid))).error).toBeNull()
  return sid
}
const vote = (i: number, sid: string, choice = 'play', request = randomUUID()) => actors[i].client.rpc('cast_session_vote', { ...sidArgs(sid), choice_input: choice, request_id: request })
const join = (i: number, sid: string, request = randomUUID()) => actors[i].client.rpc('join_session', { ...sidArgs(sid), request_id: request })
const withdraw = (i: number, pid: string) => actors[i].client.rpc('withdraw_participation', { participant_id_input: pid, request_id: randomUUID() })
const closeVoting = (sid: string) => localSql(`update public.sessions set voting_closes_at=clock_timestamp()-interval '1 second' where id=${q(sid)}`)

// Hold an actual PostgreSQL row lock, then queue HTTP transactions behind it.
// No service credentials in command arguments or child-process output.
async function holdSession(sid: string) {
  const child = spawn('docker', ['exec','-i','supabase_db_bjbc','psql','-U','postgres','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1'])
  child.stderr.resume()
  const complete = new Promise<void>((resolve, reject) => { child.on('error', () => reject(new Error('Local row-lock fixture could not start'))); child.on('exit', (code) => code === 0 ? resolve() : reject(new Error('Local row-lock fixture failed'))) })
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Row-lock acquisition timed out')),5000)
    let buffer = ''
    child.stdout.on('data', (chunk) => { buffer += String(chunk); if (buffer.includes('BJBC_LOCK_HELD')) { clearTimeout(timeout); resolve() } })
    child.stdin.write(`begin; select id from public.sessions where id=${q(sid)} for update; select 'BJBC_LOCK_HELD';\n`)
  })
  return async () => { child.stdin.end('commit;\n'); await complete }
}
async function waitForBlocked(count: number) {
  const until = Date.now()+5000
  while (Date.now()<until) {
    const n = Number(localSql("select count(*) from pg_stat_activity where datname='postgres' and wait_event_type='Lock' and (query like '%join_session%' or query like '%cast_session_vote%')"))
    if (n>=count) return
    await new Promise((resolve) => setTimeout(resolve,30))
  }
  throw new Error('Expected concurrent API transactions were not blocked on the session lock')
}

describe('real participation transactions and concurrency', () => {
  beforeAll(async () => {
    const probe = await operator.rpc('get_session_snapshot', { session_id_input: randomUUID() })
    expect(probe.error?.code, 'Task 3 RPC must exist before live checks').not.toBe('PGRST202')
    for (let i=0;i<5;i++) {
      const phone = `+60112${String(Date.now()+i).slice(-7)}`, password = randomBytes(24).toString('base64url')
      const created = await operator.auth.admin.createUser({ phone,password,phone_confirm:true,user_metadata:{display_name:`Synthetic Task3 ${i}`} })
      expect(created.error?.code).toBeUndefined()
      const actor = { uid: created.data.user!.id, client: createClient(url,key,options) }
      actors.push(actor)
      expect((await actor.client.auth.signInWithPassword({phone,password})).error).toBeNull()
      expect((await operator.from('memberships').update({ status:i===4?'pending':'active',role:i===0?'admin':'member' }).eq('user_id',actor.uid)).error).toBeNull()
    }
  },30000)
  afterAll(async () => {
    if (sessions.length) {
      const ids=sessions.map(q).join(','), uids=actors.map((a)=>q(a.uid)).join(',')
      localSql(`begin;
        delete from public.audit_logs where actor_user_id in (${uids});
        delete from app_private.operation_requests where actor_user_id in (${uids});
        delete from public.waitlist_offers where participant_id in (select id from public.participants where session_id in (${ids}));
        delete from public.votes where poll_id in (select id from public.polls where session_id in (${ids}));
        delete from public.participants where session_id in (${ids});
        delete from public.polls where session_id in (${ids});
        delete from public.sessions where id in (${ids});
        delete from public.players where user_id in (${uids}); commit;`)
    }
    for (const actor of actors) expect((await operator.auth.admin.deleteUser(actor.uid)).error?.code).toBeUndefined()
  })
  it('real votes allocate in server timestamp order, overflow waits and retries deduplicate', async () => {
    const sid=await makeSession(), request=randomUUID()
    const one=await vote(1,sid,'play',request), two=await vote(2,sid), three=await vote(3,sid)
    expect(one.error).toBeNull(); expect(two.error).toBeNull(); expect(three.error).toBeNull()
    expect([one.data.participation_status,two.data.participation_status,three.data.participation_status]).toEqual(['confirmed','confirmed','waitlisted'])
    expect((await vote(1,sid,'play',request)).data).toEqual(one.data)
    expect((await vote(1,sid,'pass',request)).error?.message).toBe('REQUEST_ID_CONFLICT')
    expect(localSql(`select bool_and(queue_joined_at>previous) from (select queue_joined_at,lag(queue_joined_at) over(order by queue_joined_at,id) previous from public.participants where session_id=${q(sid)}) ordered`)).toBe('t')
  })
  it('two HTTP voters contend behind the same row lock for the last slot: one confirmed', async () => {
    const sid=await makeSession(1), release=await holdSession(sid)
    const calls=[vote(1,sid),vote(2,sid)].map((p)=>Promise.resolve(p))
    try { await waitForBlocked(2) } finally { await release() }
    const result=await Promise.all(calls)
    expect(result.map((r)=>r.error)).toEqual([null,null])
    expect(result.map((r)=>r.data.participation_status).sort()).toEqual(['confirmed','waitlisted'])
  })
  it('two simultaneous post-voting joins cannot overbook the final place', async () => {
    const sid=await makeSession(1); closeVoting(sid)
    const release=await holdSession(sid), calls=[join(1,sid),join(2,sid)].map((p)=>Promise.resolve(p))
    try { await waitForBlocked(2) } finally { await release() }
    const result=await Promise.all(calls)
    expect(result.map((r)=>r.error)).toEqual([null,null])
    expect(result.map((r)=>r.data.participation_status).sort()).toEqual(['confirmed','waitlisted'])
  })
  it('same concurrent request creates exactly one participation and original result', async () => {
    const sid=await makeSession(), request=randomUUID()
    const result=await Promise.all([vote(1,sid,'play',request),vote(1,sid,'play',request)])
    expect(result.map((r)=>r.error)).toEqual([null,null]); expect(result[0].data).toEqual(result[1].data)
    expect(localSql(`select count(*) from public.participants where session_id=${q(sid)}`)).toBe('1')
  })
  it('withdraw/rejoin and late direct requests cannot bypass the existing queue', async () => {
    const sid=await makeSession(1), first=await vote(1,sid)
    await vote(2,sid)
    expect((await join(3,sid)).error?.message).toBe('VOTING_STILL_OPEN')
    expect((await withdraw(1,first.data.participant_id)).data.charge_percent).toBe(0)
    expect((await vote(1,sid)).data.participation_status).toBe('waitlisted')
    closeVoting(sid)
    expect((await join(3,sid)).data.participation_status).toBe('waitlisted')
    expect(localSql(`select string_agg(pl.user_id::text,',' order by p.queue_joined_at,p.id) from public.participants p join public.players pl on pl.id=p.player_id where p.session_id=${q(sid)} and p.participation_status='waitlisted'`)).toBe([actors[2].uid,actors[1].uid,actors[3].uid].join(','))
  })
  it('published details are protected and draft/admin data remains inaccessible to members', async () => {
    const sid=await makeSession()
    expect((await actors[1].client.rpc('publish_session',sidArgs(sid))).error?.message).toBe('ADMIN_REQUIRED')
    expect((await actors[1].client.from('sessions').update({capacity:999}).eq('id',sid)).error?.code).toBe('42501')
    expect((await vote(4,sid)).error?.message).toBe('MEMBERSHIP_NOT_ACTIVE')
    const first=await vote(1,sid)
    expect((await withdraw(2,first.data.participant_id)).error?.message).toBe('PARTICIPANT_NOT_FOUND')
    expect((await actors[1].client.rpc('join_session',{...sidArgs(sid),user_id:actors[0].uid,at_input:'2020-01-01'})).error?.code).toBe('PGRST202')
    expect((await actors[1].client.schema('app_private').from('operation_requests').select('*')).error?.code).toBe('PGRST106')
    expect(localSql("select has_function_privilege('authenticated','app_private.begin_operation(text,jsonb,uuid)','EXECUTE') or has_function_privilege('service_role','app_private.withdraw_locked(uuid,public.sessions,timestamptz)','EXECUTE')")).toBe('f')
  })
  it('snapshot is authoritative and includes safe roster fields without phone/debt leakage', async () => {
    const sid=await makeSession(); await vote(1,sid)
    const result=await actors[2].client.rpc('get_session_snapshot',{session_id_input:sid})
    expect(result.error).toBeNull(); expect(result.data.can_vote).toBe(true)
    expect(result.data.counts).toEqual({confirmed:1,held:0,waiting:0})
    expect(result.data.participation).toBeNull()
    expect(Object.keys(result.data.roster[0]).sort()).toEqual(['session_id','participant_id','display_name','participation_status','attendance'].sort())
  })
  it('server time is sampled after waiting for a session lock, so a delayed vote misses close', async () => {
    const sid=await makeSession()
    localSql(`update public.sessions set voting_closes_at=clock_timestamp()+interval '1 second' where id=${q(sid)}`)
    const release=await holdSession(sid), call=Promise.resolve(vote(1,sid))
    try { await waitForBlocked(1); await new Promise((resolve)=>setTimeout(resolve,1200)) } finally { await release() }
    expect((await call).error?.message).toBe('VOTING_CLOSED')
    expect(localSql(`select count(*) from public.participants where session_id=${q(sid)}`)).toBe('0')
  })
  it('real SQL pins the KL midnight cutoff and does not expose a caller-controlled clock', async () => {
    expect(localSql("select app_private.withdrawal_percentage('2026-10-23T20:00:00+08','2026-10-22T23:59:59+08',true)||','||app_private.withdrawal_percentage('2026-10-23T20:00:00+08','2026-10-23T00:00:00+08',true)")).toBe('0,75')
    const sid=await makeSession(), first=await vote(1,sid)
    localSql(`update public.sessions set starts_at=clock_timestamp()+interval '2 minutes',ends_at=clock_timestamp()+interval '2 hours',voting_closes_at=clock_timestamp()-interval '1 second' where id=${q(sid)}`)
    const sameDay=localSql(`select (starts_at at time zone 'Asia/Kuala_Lumpur')::date=(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date from public.sessions where id=${q(sid)}`)==='t'
    expect((await withdraw(1,first.data.participant_id)).data.charge_percent).toBe(sameDay?75:0)
    localSql(`update public.sessions set starts_at=clock_timestamp()-interval '1 second' where id=${q(sid)}`)
    expect((await join(2,sid)).error?.message).toBe('SESSION_STARTED')
  })
})

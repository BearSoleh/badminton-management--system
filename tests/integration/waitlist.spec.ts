import { randomBytes,randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createClient,type SupabaseClient } from '@supabase/supabase-js'
import { afterAll,beforeAll,describe,expect,it } from 'vitest'
import { localSql,sqlLiteral as q } from '../helpers/local-sql'

const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}
const url=process.env.SUPABASE_TEST_URL!,key=process.env.SUPABASE_TEST_PUBLISHABLE_KEY!
const operator=createClient(url,process.env.SUPABASE_TEST_SECRET_KEY!,options)
const actors:{uid:string;client:SupabaseClient}[]=[],sessions:string[]=[]
const vote=(i:number,sid:string)=>actors[i].client.rpc('cast_session_vote',{session_id_input:sid,choice_input:'play',request_id:randomUUID()})
const response=(i:number,oid:string,accept=true,request=randomUUID())=>actors[i].client.rpc('respond_to_offer',{offer_id_input:oid,accept_input:accept,request_id:request})
async function queue(mode='automatic') {
  const now=Date.now()
  const draft=await actors[0].client.rpc('save_session',{session_id_input:null,title_input:'Synthetic Task 4',venue_input:'Test court',starts_at_input:new Date(now+172800000).toISOString(),ends_at_input:new Date(now+180000000).toISOString(),voting_closes_at_input:new Date(now+86400000).toISOString(),capacity_input:1,waitlist_mode_input:mode,request_id:randomUUID()})
  expect(draft.error).toBeNull();const sid=draft.data.session_id;sessions.push(sid)
  expect((await actors[0].client.rpc('publish_session',{session_id_input:sid,request_id:randomUUID()})).error).toBeNull()
  const one=await vote(1,sid),two=await vote(2,sid),three=await vote(3,sid)
  expect([one.error,two.error,three.error]).toEqual([null,null,null])
  expect((await actors[1].client.rpc('withdraw_participation',{participant_id_input:one.data.participant_id,request_id:randomUUID()})).error).toBeNull()
  const offers=await operator.from('waitlist_offers').select('*').eq('participant_id',two.data.participant_id)
  return {sid,one:one.data,two:two.data,three:three.data,offer:offers.data?.[0]}
}
function expire(oid:string,remaining="-interval '1 second'") {
  localSql(`update public.waitlist_offers set offered_at=statement_timestamp()+${remaining}-interval '15 minutes',expires_at=statement_timestamp()+${remaining} where id=${q(oid)}`)
}
async function hold(sid:string) {
  const child=spawn('docker',['exec','-i','supabase_db_bjbc','psql','-U','postgres','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1'])
  child.stderr.resume()
  const done=new Promise<void>((resolve,reject)=>{child.on('error',()=>reject(new Error('Lock fixture failed')));child.on('exit',c=>c===0?resolve():reject(new Error('Lock fixture failed')))})
  await new Promise<void>((resolve,reject)=>{
    let buffer='';const timer=setTimeout(()=>reject(new Error('Lock acquisition timed out')),5000)
    child.stdout.on('data',chunk=>{buffer+=String(chunk);if(buffer.includes('HELD_TASK4')){clearTimeout(timer);resolve()}})
    child.stdin.write(`begin;select id from public.sessions where id=${q(sid)} for update;select 'HELD_TASK4';\n`)
  })
  return async()=>{child.stdin.end('commit;\n');await done}
}
async function blocked(n:number) {
  const until=Date.now()+5000
  while(Date.now()<until) {
    if(Number(localSql("select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%respond_to_offer%'"))>=n)return
    await new Promise(r=>setTimeout(r,50))
  }
  throw new Error('HTTP offer responses did not reach the held row lock')
}

describe('real waiting-list API, concurrency and scheduler',()=>{
  beforeAll(async()=>{
    const probe=await operator.rpc('respond_to_offer',{offer_id_input:randomUUID(),accept_input:true,request_id:randomUUID()})
    expect(probe.error?.code,'Task 4 RPC must be installed').not.toBe('PGRST202')
    for(let i=0;i<5;i++) {
      const phone=`+60112${String(Date.now()+i).slice(-7)}`,password=randomBytes(24).toString('base64url')
      const created=await operator.auth.admin.createUser({phone,password,phone_confirm:true,user_metadata:{display_name:`Synthetic Task4 ${i}`}})
      expect(created.error).toBeNull();const uid=created.data.user!.id,client=createClient(url,key,options)
      actors.push({uid,client})
      expect((await operator.from('memberships').update({status:i===4?'pending':'active',role:i===0?'admin':'member'}).eq('user_id',uid)).error).toBeNull()
      expect((await client.auth.signInWithPassword({phone,password})).error).toBeNull()
    }
  },30000)
  afterAll(async()=>{
    if(actors.length) {
      const uids=actors.map(a=>q(a.uid)).join(',')
      localSql(`begin;
        delete from public.audit_logs where actor_user_id in (${uids}) or entity_id in(select p.id from public.participants p join public.sessions s on s.id=p.session_id where s.created_by in (${uids})) or entity_id in(select id from public.waitlist_offers where participant_id in(select p.id from public.participants p join public.sessions s on s.id=p.session_id where s.created_by in (${uids})));
        delete from app_private.operation_requests where actor_user_id in (${uids});
        delete from app_private.notification_outbox where event_key in(select event_key from public.notifications where user_id in (${uids}));
        delete from public.notifications where user_id in (${uids});
        delete from public.waitlist_offers where participant_id in(select p.id from public.participants p join public.sessions s on s.id=p.session_id where s.created_by in (${uids}));
        delete from public.votes where user_id in (${uids});
        delete from public.participants where session_id in(select id from public.sessions where created_by in (${uids}));
        delete from public.polls where session_id in(select id from public.sessions where created_by in (${uids}));
        delete from public.sessions where created_by in (${uids});
        delete from public.players where user_id in (${uids});commit;`)
      for(const a of actors)expect((await operator.auth.admin.deleteUser(a.uid)).error).toBeNull()
    }
  })
  it('real 15-minute hold, ownership/read permissions, retry IDs and decline promotion',async()=>{
    const {sid,two,three,offer}=await queue()
    expect(Date.parse(offer.expires_at)-Date.parse(offer.offered_at)).toBe(900000)
    expect((await actors[1].client.from('waitlist_offers').select('*').eq('id',offer.id)).data).toEqual([])
    expect((await response(3,offer.id)).error?.message).toBe('OFFER_NOT_FOUND')
    expect((await response(4,offer.id)).error?.message).toBe('MEMBERSHIP_NOT_ACTIVE')
    expect((await actors[0].client.rpc('expire_waitlist_offers')).error?.code).toBe('42501')
    const request=randomUUID(),declined=await response(2,offer.id,false,request)
    expect(declined.error).toBeNull();expect(declined.data).toMatchObject({offer_state:'declined',charge_percent:0})
    expect((await response(2,offer.id,false,request)).data).toEqual(declined.data)
    expect((await response(2,offer.id,true,request)).error?.message).toBe('REQUEST_ID_CONFLICT')
    expect((await operator.from('waitlist_offers').select('id').eq('participant_id',three.participant_id).eq('state','pending')).data).toHaveLength(1)
    const snap=await actors[2].client.rpc('get_session_snapshot',{session_id_input:sid})
    expect(snap.data.counts).toEqual({confirmed:0,held:1,waiting:0})
    expect(snap.data.participation.id).toBe(two.participant_id)
    const notices=await actors[2].client.from('notifications').select('*').order('created_at')
    expect(notices.data?.every(n=>n.user_id===actors[2].uid)).toBe(true)
    expect((await actors[3].client.rpc('mark_notification_read',{notification_id_input:notices.data![0].id})).error?.message).toBe('NOTIFICATION_NOT_FOUND')
    expect((await actors[2].client.rpc('mark_notification_read',{notification_id_input:notices.data![0].id})).error).toBeNull()
    expect((await actors[2].client.rpc('respond_to_offer',{offer_id_input:offer.id,accept_input:true,request_id:randomUUID(),at_input:'2026-01-01'})).error?.code).toBe('PGRST202')
  })
  it('two simultaneous Continue requests behind a real lock confirm once',async()=>{
    const {sid,offer}=await queue(),release=await hold(sid)
    const calls=[response(2,offer.id),response(2,offer.id)].map(p=>Promise.resolve(p))
    try{await blocked(2)}finally{await release()}
    const result=await Promise.all(calls)
    expect(result.filter(r=>!r.error)).toHaveLength(1)
    expect(result.find(r=>r.error)?.error?.message).toBe('OFFER_NOT_PENDING')
    expect(localSql(`select count(*) from public.participants where session_id=${q(sid)} and participation_status='confirmed'`)).toBe('1')
  })
  it('same concurrent request returns the same accepted result and one audit transition',async()=>{
    const {sid,offer}=await queue(),request=randomUUID(),release=await hold(sid)
    const calls=[response(2,offer.id,true,request),response(2,offer.id,true,request)].map(p=>Promise.resolve(p))
    try{await blocked(2)}finally{await release()}
    const result=await Promise.all(calls)
    expect(result.map(r=>r.error)).toEqual([null,null]);expect(result[0].data).toEqual(result[1].data)
    expect(localSql(`select count(*) from public.audit_logs where action='waitlist_offer_accepted' and entity_id=${q(offer.id)}`)).toBe('1')
  })
  it('response queued before expiry is refused after the session lock is released',async()=>{
    const {sid,offer,three}=await queue();expire(offer.id,"interval '1 second'")
    const release=await hold(sid),call=Promise.resolve(response(2,offer.id))
    try{await blocked(1);await new Promise(r=>setTimeout(r,1200))}finally{await release()}
    expect((await call).data).toMatchObject({offer_state:'expired',charge_percent:0})
    expect((await operator.from('waitlist_offers').select('id').eq('participant_id',three.participant_id).eq('state','pending')).data).toHaveLength(1)
  })
  it('duplicate workers and a concurrent stale response create only one next offer',async()=>{
    const {offer,three}=await queue();expire(offer.id)
    const result=await Promise.all([operator.rpc('expire_waitlist_offers'),operator.rpc('expire_waitlist_offers'),response(2,offer.id)])
    expect(result.slice(0,2).map(r=>r.error)).toEqual([null,null])
    expect(result[2].error?.message??result[2].data.offer_state).toMatch(/OFFER_NOT_PENDING|expired/)
    expect((await operator.from('waitlist_offers').select('id').eq('participant_id',three.participant_id)).data).toHaveLength(1)
    expect(localSql(`select count(*) from public.notifications where event_key like 'offer:%' and payload->>'offer_id'=(select id::text from public.waitlist_offers where participant_id=${q(three.participant_id)} and state='pending')`)).toBe('1')
  })
  it('manual queue overrides and late consent are admin-only and cannot overbook',async()=>{
    const {sid,two,three}=await queue('manual')
    const args={participant_id_input:three.participant_id,reason_input:'Player agreed; earlier player unavailable',request_id:randomUUID()}
    expect((await actors[1].client.rpc('admin_offer_slot',args)).error?.message).toBe('ADMIN_REQUIRED')
    expect((await actors[0].client.rpc('admin_offer_slot',args)).error).toBeNull()
    expect((await actors[0].client.rpc('admin_offer_slot',{...args,participant_id_input:two.participant_id,request_id:randomUUID()})).error?.message).toBe('NO_VACANCY')
    localSql(`update public.sessions set operational_status='cancelled' where id=${q(sid)}`)
    expect(localSql(`select count(*) from public.waitlist_offers o join public.participants p on p.id=o.participant_id where p.session_id=${q(sid)} and o.state='pending'`)).toBe('0')
  })
  it('scheduler independently expires a hold with no browser or client worker call',async()=>{
    expect(localSql("select count(*) from cron.job where jobname='bjbc-waitlist-minute' and active and schedule='* * * * *' and command='select public.expire_waitlist_offers();'")).toBe('1')
    const {offer,three}=await queue();expire(offer.id)
    const until=Date.now()+75000
    let state='pending'
    while(Date.now()<until) {
      state=localSql(`select state from public.waitlist_offers where id=${q(offer.id)}`)
      if(state==='expired')break
      await new Promise(r=>setTimeout(r,1000))
    }
    expect(state).toBe('expired')
    expect((await operator.from('waitlist_offers').select('id').eq('participant_id',three.participant_id).eq('state','pending')).data).toHaveLength(1)
    expect(localSql("select count(*)>0 from cron.job_run_details where jobid=(select jobid from cron.job where jobname='bjbc-waitlist-minute') and status='succeeded'")).toBe('t')
  },85000)
})

import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { afterAll,beforeAll,describe,expect,it } from 'vitest'
import { billingFixture } from '../helpers/billing-fixture'
import { localSql,sqlLiteral as q } from '../helpers/local-sql'

let f:Awaited<ReturnType<typeof billingFixture>>
const preview=(sid:string,i=0)=>f.actors[i].client.rpc('get_fee_preview',{session_id_input:sid})
const mark=(pid:string,attendance='present',reason='',i=0,request=randomUUID())=>f.actors[i].client.rpc('set_attendance',{participant_id_input:pid,attendance_input:attendance,reason_input:reason,request_id:request})
const draft=(sid:string,fee=2001,i=0,request=randomUUID())=>f.actors[i].client.rpc('save_fee_draft',{session_id_input:sid,full_fee_sen_input:fee,court_cost_sen_input:10000,shuttle_quantity_input:3,shuttle_cost_sen_input:4500,notes_input:'Synthetic private cost notes',request_id:request})
const publish=(sid:string,token:string,fee=2001,request=randomUUID(),reason='')=>f.actors[0].client.rpc('publish_session_fee',{session_id_input:sid,full_fee_sen_input:fee,review_token_input:token,reason_input:reason,request_id:request})
async function ready(fee=2001) {
  const s=await f.session()
  expect((await mark(s.pids[0])).error).toBeNull();expect((await mark(s.pids[1],'no_show')).error).toBeNull();expect((await draft(s.sid,fee)).error).toBeNull()
  const p=await preview(s.sid);expect(p.error).toBeNull();return {...s,token:p.data.review_token}
}
async function hold(sid:string) {
  const child=spawn('docker',['exec','-i','supabase_db_bjbc','psql','-U','postgres','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1'])
  child.stderr.resume()
  const done=new Promise<void>((resolve,reject)=>{child.on('error',()=>reject(new Error('Billing lock failed')));child.on('exit',c=>c===0?resolve():reject(new Error('Billing lock failed')))})
  await new Promise<void>((resolve,reject)=>{let buffer='';const timer=setTimeout(()=>reject(new Error('Billing lock timed out')),5000);child.stdout.on('data',chunk=>{buffer+=String(chunk);if(buffer.includes('TASK5_HELD')){clearTimeout(timer);resolve()}});child.stdin.write(`begin;select id from public.sessions where id=${q(sid)} for update;select 'TASK5_HELD';\n`)})
  return async()=>{child.stdin.end('commit;\n');await done}
}
async function blocked() {
  const until=Date.now()+5000
  while(Date.now()<until){if(Number(localSql("select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%publish_session_fee%'"))>=2)return;await new Promise(r=>setTimeout(r,50))}
  throw new Error('Fee calls did not reach database lock')
}
describe('real attendance and fee API, RLS and concurrency',()=>{
  beforeAll(async()=>{f=await billingFixture()},30000)
  afterAll(async()=>{await f?.cleanup()})
  it('requires marked attendance and post-session publication; drafts keep Fee not yet set',async()=>{
    const {sid,pids}=await f.session()
    expect((await draft(sid)).error).toBeNull();const p=await preview(sid)
    expect(p.data.unmarked_count).toBe(2)
    expect((await publish(sid,p.data.review_token)).error?.message).toBe('ATTENDANCE_UNMARKED')
    expect((await f.operator.from('fee_versions').select('id').eq('session_id',sid)).data).toEqual([])
    expect((await f.operator.from('sessions').select('billing_status').eq('id',sid).single()).data?.billing_status).toBe('not_published')
    expect((await mark(pids[2],'no_show')).error?.message).toBe('ATTENDANCE_NOT_ELIGIBLE')
    localSql(`update public.sessions set ends_at=clock_timestamp()+interval '1 hour' where id=${q(sid)}`)
    expect((await draft(sid)).error?.message).toBe('FEE_PUBLICATION_NOT_OPEN')
  })
  it('publishes private 2001/1501 snapshots, audited corrections and intentional zero',async()=>{
    const {sid,pids,token}=await ready()
    const result=await publish(sid,token);expect(result.error).toBeNull()
    const own=await f.actors[1].client.from('charges').select('*').eq('session_id',sid)
    expect(own.data).toHaveLength(1);expect(own.data?.[0]).toMatchObject({percent:100,amount_sen:2001,eligibility_snapshot:{attendance:'present'}})
    expect((await f.actors[3].client.from('charges').select('percent,amount_sen').eq('session_id',sid)).data).toEqual([{percent:75,amount_sen:1501}])
    expect((await f.actors[1].client.from('session_costs').select('*').eq('session_id',sid)).data).toEqual([])
    expect((await mark(pids[0],'no_show')).error?.message).toBe('REASON_REQUIRED')
    expect((await mark(pids[0],'no_show','Corrected review')).error).toBeNull()
    expect((await f.actors[1].client.from('charges').select('eligibility_snapshot').eq('session_id',sid)).data?.[0].eligibility_snapshot.attendance).toBe('present')
    expect((await draft(sid,0)).error).toBeNull();const next=await preview(sid)
    expect((await publish(sid,next.data.review_token,0)).error?.message).toBe('REASON_REQUIRED')
    expect((await publish(sid,next.data.review_token,0,randomUUID(),'Waived full fee for all players')).error).toBeNull()
    const zero=await f.actors[1].client.from('charges').select('amount_sen,is_current,status').eq('session_id',sid).eq('is_current',true)
    expect(zero.data).toEqual([{amount_sen:0,is_current:true,status:'voided'}])
    expect(localSql(`select count(*) from app_private.fee_cost_snapshots c join public.fee_versions v on v.id=c.fee_version_id where v.session_id=${q(sid)}`)).toBe('2')
  })
  it('denies caller identity/rate/time forgery and unauthorized table mutations',async()=>{
    const {sid,pids}=await f.session()
    expect((await mark(pids[0],'present','',1)).error?.message).toBe('ADMIN_REQUIRED')
    expect((await draft(sid,2001,4)).error?.message).toBe('MEMBERSHIP_NOT_ACTIVE')
    expect((await preview(sid,1)).error?.message).toBe('ADMIN_REQUIRED')
    expect((await f.actors[1].client.from('participants').update({attendance:'no_show'}).eq('id',pids[1])).error?.code).toBe('42501')
    expect((await f.actors[0].client.rpc('set_attendance',{participant_id_input:pids[0],attendance_input:'present',reason_input:'',request_id:randomUUID(),actor_id_input:f.actors[1].uid})).error?.code).toBe('PGRST202')
    expect((await draft(sid,-1)).error?.message).toBe('INVALID_FEE')
    expect((await f.operator.from('fee_versions').update({full_fee_sen:1}).eq('session_id',sid)).error?.code).toBe('42501')
  })
  it('rejects stale attendance/cost previews and cancelled sessions without liabilities',async()=>{
    const {sid,pids,token}=await ready()
    expect((await mark(pids[0],'no_show','Roster correction')).error).toBeNull()
    expect((await publish(sid,token)).error?.message).toBe('FEE_PREVIEW_STALE')
    const p=await preview(sid);expect((await draft(sid,2000)).error).toBeNull()
    expect((await publish(sid,p.data.review_token)).error?.message).toBe('FEE_PREVIEW_STALE')
    localSql(`update public.sessions set operational_status='cancelled' where id=${q(sid)}`)
    const cancelled=await preview(sid)
    expect(cancelled.data.rows.map((r:{amount_sen:number})=>r.amount_sen)).toEqual([0,0,0])
    expect((await publish(sid,cancelled.data.review_token,2000)).error?.message).toBe('FEE_PUBLICATION_NOT_OPEN')
    expect((await f.operator.from('charges').select('id').eq('session_id',sid)).data).toEqual([])
  })
  it('same concurrent publication request returns one fee version and one audit',async()=>{
    const {sid,token}=await ready(),request=randomUUID(),release=await hold(sid)
    const calls=[publish(sid,token,2001,request),publish(sid,token,2001,request)].map(p=>Promise.resolve(p))
    try{await blocked()}finally{await release()}
    const result=await Promise.all(calls);expect(result.map(r=>r.error)).toEqual([null,null]);expect(result[0].data).toEqual(result[1].data)
    expect(localSql(`select count(*) from public.fee_versions where session_id=${q(sid)}`)).toBe('1')
    expect(localSql(`select count(*) from public.audit_logs where entity_id=${q(sid)} and action='session_fee_published'`)).toBe('1')
    expect((await publish(sid,token,2000,request)).error?.message).toBe('REQUEST_ID_CONFLICT')
  })
  it('different concurrent publish IDs cannot supersede the same reviewed state',async()=>{
    const {sid,token}=await ready(),release=await hold(sid)
    const calls=[publish(sid,token),publish(sid,token)].map(p=>Promise.resolve(p))
    try{await blocked()}finally{await release()}
    const result=await Promise.all(calls)
    expect(result.filter(r=>!r.error)).toHaveLength(1)
    expect(result.find(r=>r.error)?.error?.message).toBe('FEE_PREVIEW_STALE')
    expect(localSql(`select count(*) from public.charges where session_id=${q(sid)} and is_current`)).toBe('3')
  })
  it('preserves suspended own obligation access and blocks payment-linked replacement',async()=>{
    const {sid,pids,token}=await ready();expect((await publish(sid,token)).error).toBeNull()
    const charge=await f.operator.from('charges').select('id').eq('participant_id',pids[0]).single()
    localSql(`insert into public.payments(charge_id,method,amount_sen,submitted_by,idempotency_key) values(${q(charge.data!.id)},'cash',2001,${q(f.actors[0].uid)},${q(randomUUID())});update public.memberships set status='suspended' where user_id=${q(f.actors[1].uid)};`)
    try{expect((await f.actors[1].client.from('charges').select('amount_sen').eq('session_id',sid)).data).toEqual([{amount_sen:2001}])}
    finally{localSql(`update public.memberships set status='active' where user_id=${q(f.actors[1].uid)}`)}
    expect((await draft(sid,2000)).error).toBeNull();const p=await preview(sid)
    expect((await publish(sid,p.data.review_token,2000,randomUUID(),'Correction')).error?.message).toBe('PAYMENT_ADJUSTMENT_REQUIRED')
  })
})

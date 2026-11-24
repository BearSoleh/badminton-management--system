import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { afterAll,beforeAll,describe,expect,it } from 'vitest'
import { adminFixture,qrPng } from '../helpers/admin-fixture'
import { localSql,sqlLiteral as q } from '../helpers/local-sql'
let f:Awaited<ReturnType<typeof adminFixture>>
describe('real Task 8 guarded administration and private QR',()=>{
  beforeAll(async()=>{f=await adminFixture()});afterAll(async()=>{await f?.cleanup()})
  const change=(actor:number,target:number,status:string,role='member',oldStatus='active',oldRole='member',rid=randomUUID())=>f.actors[actor].client.rpc('admin_set_membership',{target_user_id_input:f.actors[target].uid,status_input:status,role_input:role,expected_status_input:oldStatus,expected_role_input:oldRole,reason_input:'Synthetic independent membership review',request_id:rid})
  const save=(revision:number,path:string|null=null,rid=randomUUID())=>f.actors[0].client.rpc('save_club_settings',{bank_name_input:'Synthetic Pilot Bank',bank_account_name_input:'Synthetic Club',bank_account_number_input:'0000000000',qr_path_input:path,expected_revision_input:revision,recipient_checked_input:true,reason_input:'Synthetic recipient checked outside app',request_id:rid})
  it('enforces current admin membership, audited approval and stale/retry guards',async()=>{
    expect((await f.actors[1].client.rpc('get_admin_dashboard')).error?.message).toBe('ADMIN_REQUIRED')
    const rid=randomUUID(),first=await change(0,4,'active','member','pending','member',rid);expect(first.error).toBeNull();expect((await change(0,4,'active','member','pending','member',rid)).data).toEqual(first.data)
    expect((await change(0,4,'active','member','pending')).error?.message).toBe('MEMBERSHIP_STALE')
    expect((await change(0,0,'suspended','admin','active','admin')).error?.message).toBe('SELF_CHANGE_DENIED')
    expect((await change(0,1,'suspended')).error).toBeNull();expect((await f.actors[1].client.rpc('get_admin_members',{search_input:'',page_input:0})).error?.message).toBe('MEMBERSHIP_NOT_ACTIVE')
    expect((await change(0,1,'active','member','suspended')).error).toBeNull()
  })
  it('serializes mutually suspending administrators and preserves an active administrator',async()=>{
    localSql(`update public.memberships set role='admin' where user_id=${q(f.actors[2].uid)}`)
    const child=spawn('docker',['exec','-i','supabase_db_bjbc','psql','-U','postgres','-d','postgres','-X','-At']);child.stderr.resume()
    const done=new Promise<void>((resolve,reject)=>{child.on('error',()=>reject(new Error('Admin gate failed')));child.on('exit',c=>c===0?resolve():reject(new Error('Admin gate failed')))})
    await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Admin gate timeout')),5000);child.stdout.on('data',b=>{if(String(b).includes('ADMIN_GATE_HELD')){clearTimeout(timer);resolve()}});child.stdin.write("begin;select id from app_private.admin_membership_guard where id for update;select 'ADMIN_GATE_HELD';\n")})
    const calls=[Promise.resolve(change(0,2,'suspended','admin','active','admin')),Promise.resolve(change(2,0,'suspended','admin','active','admin'))]
    try{let blocked=0;const until=Date.now()+7000;while(Date.now()<until){blocked=Number(localSql("select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%admin_set_membership%'"));if(blocked>=2)break;await new Promise(r=>setTimeout(r,50))}expect(blocked).toBeGreaterThanOrEqual(2)}finally{child.stdin.end('commit;\n');await done}
    try{const result=await Promise.all(calls);expect(result.filter(r=>!r.error)).toHaveLength(1);expect(localSql("select count(*) from public.memberships where role='admin' and status='active'")).toBe('1')}finally{localSql(`update public.memberships set status='active',role=case when user_id=${q(f.actors[0].uid)} then 'admin' else 'member' end where user_id in (${q(f.actors[0].uid)},${q(f.actors[2].uid)})`)}
  })
  it('validates private QR bytes/owner, denies direct signing and enforces settings revisions',async()=>{
    const path=`${randomUUID()}.png`;f.qrObjects.push(path)
    expect((await f.actors[1].client.storage.from('payment-qr').upload(path,qrPng,{contentType:'image/png'})).error).not.toBeNull()
    expect((await f.actors[0].client.storage.from('payment-qr').upload(path,qrPng,{contentType:'image/png'})).error).toBeNull()
    expect((await save(0,path)).error?.message).toBe('QR_NOT_VERIFIED')
    expect((await f.qrEndpoint(path,1)).status).toBe(403);expect((await f.qrEndpoint(path)).status).toBe(200)
    expect((await f.actors[0].client.storage.from('payment-qr').createSignedUrl(path,99999)).error).not.toBeNull()
    const rid=randomUUID(),saved=await save(0,path,rid);expect(saved.error).toBeNull();expect((await save(0,path,rid)).data).toEqual(saved.data);expect((await save(0,path)).error?.message).toBe('SETTINGS_STALE')
    const invalid=`${randomUUID()}.png`;f.qrObjects.push(invalid);expect((await f.actors[0].client.storage.from('payment-qr').upload(invalid,new TextEncoder().encode('<svg onload="bad"/>'),{contentType:'image/png'})).error).toBeNull();expect((await f.qrEndpoint(invalid)).status).toBe(400)
    expect((await f.actors[1].client.from('club_settings').select('bank_name').single()).data?.bank_name).toBe('Synthetic Pilot Bank')
  })
  it('uses approved money only and keeps refunds separate from outstanding snapshots',async()=>{
    const s=await f.ready(await f.session(),await f.exchange((await f.invite(f.sessions.at(-1)!)).token))
    expect((await f.actors[0].client.rpc('get_admin_dashboard')).data.received_sen).toBe('0')
    const cash=await f.actors[0].client.rpc('record_cash_payment',{charge_id_input:s.id,reason_input:'Synthetic full cash received',request_id:randomUUID()});expect(cash.error).toBeNull()
    expect((await f.actors[0].client.rpc('get_admin_dashboard')).data).toMatchObject({received_sen:'2001',outstanding_sen:'0',refunded_sen:'0'})
    expect((await f.actors[0].client.rpc('cancel_session',{session_id_input:s.session_id,reason_input:'Synthetic refund tracking',request_id:randomUUID()})).error).toBeNull()
    expect((await f.actors[0].client.rpc('get_admin_dashboard')).data).toMatchObject({received_sen:'2001',pending_refund_sen:'2001',outstanding_sen:'0'})
    expect((await f.actors[0].client.rpc('record_payment_refund',{payment_id_input:cash.data.payment_id,reason_input:'Synthetic cash actually returned',request_id:randomUUID()})).error).toBeNull()
    expect((await f.actors[0].client.rpc('get_admin_dashboard')).data).toMatchObject({received_sen:'2001',refunded_sen:'2001',retained_sen:'0'})
    expect((await f.actors[0].client.rpc('get_admin_audit',{search_input:'club_settings',page_input:0})).data.total).toBe(1)
  })
})

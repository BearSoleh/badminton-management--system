import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it } from 'vitest'
import { createIdentityDatabase } from '../helpers/identity-db.mjs'

let db:PGlite
const [admin,member,other,suspended]=Array.from({length:4},()=>randomUUID())
const hash=(n:number)=>String(n).padStart(64,'a')
async function call(uid:string|null,sql:string,args:unknown[]=[],role='authenticated') {
  await db.exec('savepoint guest_call')
  try{await db.exec(`set role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid??'']);const r=await db.query<{r:Record<string,unknown> & {participation:{id:string};offer:{state:string};guest_id:string}}>(sql,args);await db.exec('reset role;release savepoint guest_call');return r.rows[0]?.r}
  catch(e){await db.exec('rollback to savepoint guest_call;reset role;release savepoint guest_call');throw e}
}
const service=(sql:string,args:unknown[]=[])=>call(null,sql,args,'service_role')
async function session(capacity=4) {
  const s=await call(admin,"select public.save_session(null,'Synthetic guest game','Test court',now()+interval '2 days',now()+interval '2 days 2 hours',$1,now()+interval '1 day','automatic',$2) r",[capacity,randomUUID()])
  await call(admin,'select public.publish_session($1,$2) r',[s.session_id,randomUUID()]);return s.session_id as string
}
async function invite(sid:string,n=1,gid:string|null=null,uid=member,verified=false) {
  return call(uid,'select public.issue_guest_invitation($1,$2,$3,$4,$5,$6,$7,$8) r',[sid,gid,'Synthetic Guest','+601129998877',hash(n),verified,verified?'Identity checked outside app':'Sponsored guest',randomUUID()])
}
const exchange=(n=1,s=9)=>service('select public.exchange_guest_capability($1,$2) r',[hash(n),hash(s)])
const action=(s=9,op='snapshot',data:object={},rid=randomUUID())=>service('select public.guest_portal_action($1,$2,$3,$4) r',[hash(s),op,data,rid])

describe('Task 7 guest security, eligibility and verified identity',()=>{
  beforeAll(async()=>{db=await createIdentityDatabase()})
  beforeEach(async()=>{await db.exec('begin');for(const [i,uid] of [admin,member,other,suspended].entries())await db.query('insert into auth.users(id,phone,raw_user_meta_data) values($1,$2,$3)',[uid,`60112456780${i}`,{display_name:`Synthetic ${i}`}]);await db.exec("update public.memberships set status='active'");await db.query("update public.memberships set role='admin' where user_id=$1",[admin]);await db.query("update public.memberships set status='suspended' where user_id=$1",[suspended])})
  afterEach(async()=>{await db.exec('rollback')});afterAll(async()=>{await db?.close()})
  it('scopes one-time exchange and rejects invalid, expired, revoked and replayed invitations',async()=>{
    const sid=await session(),i=await invite(sid);expect(i.expires_at).toBeTruthy()
    await expect(exchange(8)).rejects.toThrow('ACCESS_UNAVAILABLE')
    expect(await exchange()).toMatchObject({expires_at:expect.any(String)})
    await expect(exchange()).rejects.toThrow('ACCESS_UNAVAILABLE')
    expect(await action()).toMatchObject({session:{id:sid},guest:{name:'Synthetic Guest'}})
    await call(admin,'select public.revoke_guest_invitation($1,$2,$3) r',[i.token_id,'No longer authorized',randomUUID()])
    await expect(action()).rejects.toThrow('ACCESS_UNAVAILABLE')
    await invite(sid,2,i.guest_id,admin,true);await db.exec("update app_private.guest_access_tokens set expires_at=clock_timestamp()-interval '1 second',created_at=clock_timestamp()-interval '31 days' where revoked_at is null")
    await expect(exchange(2)).rejects.toThrow('ACCESS_UNAVAILABLE')
  })
  it('does not allow name/phone or ordinary members to reissue/claim existing identity',async()=>{
    const sid=await session(),i=await invite(sid)
    await expect(invite(sid,2,null,other)).rejects.toThrow('ADMIN_VERIFICATION_REQUIRED')
    await expect(invite(sid,2,i.guest_id,other,true)).rejects.toThrow('ADMIN_REQUIRED')
    await expect(call(member,'select public.verify_and_link_guest($1,$2,true,$3,$4) r',[i.guest_id,member,'Same phone',randomUUID()])).rejects.toThrow('ADMIN_REQUIRED')
    await expect(call(admin,'select public.verify_and_link_guest($1,$2,false,$3,$4) r',[i.guest_id,member,'Same phone',randomUUID()])).rejects.toThrow('IDENTITY_VERIFICATION_REQUIRED')
    await expect(invite(sid,3,null,suspended)).rejects.toThrow('MEMBERSHIP_NOT_ACTIVE')
  })
  it('allows two future confirmations, blocks the third and frees cancelled/early places',async()=>{
    const ids=await Promise.all([session(),session(),session()]),i=await invite(ids[0]);await exchange();expect((await action(9,'join')).participation_status).toBe('confirmed')
    await invite(ids[1],2,i.guest_id,admin,true);await exchange(2,8);expect((await action(8,'join')).participation_status).toBe('confirmed')
    await invite(ids[2],3,i.guest_id,admin,true);await exchange(3,7);await expect(action(7,'join')).rejects.toThrow('GUEST_ACCOUNT_REQUIRED')
    await action(9,'withdraw');expect((await action(7,'join')).participation_status).toBe('confirmed')
    await call(admin,'select public.cancel_session($1,$2,$3) r',[ids[1],'Cancelled court',randomUUID()])
    expect((await action(9,'join')).participation_status).toBe('confirmed')
  })
  it('held offers reserve a use; expiry/decline releases it and acceptance keeps consent semantics',async()=>{
    const sid=await session(1);await call(member,"select public.cast_session_vote($1,'play',$2) r",[sid,randomUUID()]);const i=await invite(sid);await exchange();expect((await action(9,'join')).participation_status).toBe('waitlisted')
    const p=await call(member,'select public.get_session_snapshot($1) r',[sid]);await call(member,'select public.withdraw_participation($1,$2) r',[p.participation.id,randomUUID()])
    expect((await action()).offer.state).toBe('pending');expect((await action(9,'respond',{accept:true})).offer_state).toBe('accepted')
    expect((await db.query<{n:number}>('select app_private.guest_uses($1,null) n',[i.guest_id])).rows[0].n).toBe(1)
  })
  it('can offer a late-cancelled rejoin already counted within the two-use limit',async()=>{
    const sid=await session(1),otherSid=await session(),i=await invite(sid);await exchange();const original=await action(9,'join')
    await invite(otherSid,2,i.guest_id,admin,true);await exchange(2,8);await action(8,'join')
    await db.query("update public.participants set participation_status='late_cancelled',charge_percent=75,liability_percent=75,attendance='not_applicable',withdrawn_at=clock_timestamp() where id=$1",[original.participant_id])
    const memberPlace=await call(member,"select public.cast_session_vote($1,'play',$2) r",[sid,randomUUID()])
    expect((await action(9,'join')).participation_status).toBe('waitlisted')
    await call(member,'select public.withdraw_participation($1,$2) r',[memberPlace.participant_id,randomUUID()])
    expect((await action()).offer).toMatchObject({state:'pending'})
    expect((await action(9,'respond',{accept:true})).offer_state).toBe('accepted')
    expect((await db.query<{n:number}>('select app_private.guest_uses($1,null) n',[i.guest_id])).rows[0].n).toBe(2)
    expect((await db.query('select liability_percent from public.participants where id=$1',[original.participant_id])).rows[0]).toEqual({liability_percent:75})
  })
  it('guest actions derive scope and cannot guess another session/charge/object',async()=>{
    const sid=await session();await invite(sid);await exchange();const foreign=await session()
    expect((await action(9,'join',{session_id:foreign})).participation_status).toBe('confirmed')
    await expect(action(9,'authorize_receipt',{path:`${randomUUID()}/${randomUUID()}/${randomUUID()}.pdf`})).rejects.toThrow('RECEIPT_ACCESS_DENIED')
    await expect(action(9,'authorize_upload',{charge_id:randomUUID()})).rejects.toThrow('CHARGE_ACCESS_DENIED')
    expect((await db.query('select session_id from public.participants')).rows).toEqual([{session_id:sid}])
    await expect(call(member,'select public.exchange_guest_capability($1,$2) r',[hash(1),hash(9)])).rejects.toThrow('permission denied')
    await db.exec("update app_private.guest_sessions set expires_at=clock_timestamp()-interval '1 second'");await expect(action()).rejects.toThrow('ACCESS_UNAVAILABLE')
  })
  it('links only verified identity, retires a duplicate operationally and retains original timestamps/history',async()=>{
    const sid=await session(),i=await invite(sid);await exchange();const g=await action(9,'join');const m=await call(member,"select public.cast_session_vote($1,'play',$2) r",[sid,randomUUID()])
    const before=(await db.query('select id,created_at,queue_joined_at,confirmed_at from public.participants order by id')).rows
    const linked=await call(admin,'select public.verify_and_link_guest($1,$2,true,$3,$4) r',[i.guest_id,member,'Verified face to face',randomUUID()]);expect(linked.duplicates).toBe(1)
    expect((await db.query('select count(*)::int n from public.participants where merged_into_id is null')).rows[0]).toEqual({n:1})
    expect((await db.query('select id,created_at,queue_joined_at,confirmed_at from public.participants order by id')).rows).toEqual(before)
    expect([g.participant_id,m.participant_id]).toContain((await call(member,'select public.get_session_snapshot($1) r',[sid])).participation.id)
    await expect(action()).rejects.toThrow('ACCESS_UNAVAILABLE')
  })
  it.each([['present','confirmed',0,1],['no_show','confirmed',0,1],['not_applicable','late_cancelled',75,1],['not_applicable','withdrawn_early',0,0],['not_applicable','offer_declined',0,0],['not_applicable','offer_expired',0,0]])('counts actual %s/%s correctly',async(attendance,status,floor,expected)=>{
    const sid=await session(),i=await invite(sid);await exchange();await action(9,'join')
    await db.query("update public.sessions set starts_at=now()-interval '3 hours',ends_at=now()-interval '1 hour',voting_closes_at=now()-interval '4 hours' where id=$1",[sid])
    await db.query('update public.participants set participation_status=$1,attendance=$2,liability_percent=$3 where session_id=$4',[status,attendance,floor,sid])
    expect((await db.query<{n:number}>('select app_private.guest_uses($1,null) n',[i.guest_id])).rows[0].n).toBe(expected)
    await call(admin,'select public.cancel_session($1,$2,$3) r',[sid,'Cancelled session does not count',randomUUID()])
    expect((await db.query<{n:number}>('select app_private.guest_uses($1,null) n',[i.guest_id])).rows[0].n).toBe(0)
  })
  it('reissue invalidates derived sessions without erasing existing unpaid charges',async()=>{
    const sid=await session(),i=await invite(sid);await exchange();const joined=await action(9,'join')
    const fee=randomUUID(),charge=randomUUID();await db.query('insert into public.fee_versions(id,session_id,full_fee_sen,version,published_by) values($1,$2,2001,1,$3)',[fee,sid,admin]);await db.query('insert into public.charges(id,participant_id,session_id,fee_version_id,percent,amount_sen) values($1,$2,$3,$4,100,2001)',[charge,joined.participant_id,sid,fee])
    const replacement=await invite(sid,2,i.guest_id,admin,true);expect(replacement.token_id).not.toBe(i.token_id);await expect(action()).rejects.toThrow('ACCESS_UNAVAILABLE');await exchange(2,8)
    expect(await action(8)).toMatchObject({charges:[{id:charge,status:'unpaid',amount_sen:2001}]})
    await db.exec("update app_private.guest_sessions set expires_at=now()-interval '1 second'");await expect(action(8)).rejects.toThrow('ACCESS_UNAVAILABLE')
    expect((await db.query('select amount_sen,status from public.charges where id=$1',[charge])).rows[0]).toEqual({amount_sen:2001,status:'unpaid'})
  })
  it('verified duplicate linking preserves paid charges/refunds and canonical Not playing withdrawal',async()=>{
    const sid=await session(),i=await invite(sid);await exchange();const g=await action(9,'join'),m=await call(member,"select public.cast_session_vote($1,'play',$2) r",[sid,randomUUID()]),fee=randomUUID()
    await db.query('insert into public.fee_versions(id,session_id,full_fee_sen,version,published_by) values($1,$2,2001,1,$3)',[fee,sid,admin])
    for(const pid of [g.participant_id,m.participant_id]){
      const charge=randomUUID();await db.query('insert into public.charges(id,participant_id,session_id,fee_version_id,percent,amount_sen) values($1,$2,$3,$4,100,2001)',[charge,pid,sid,fee])
      await call(admin,'select public.record_cash_payment($1,$2,$3) r',[charge,'Synthetic cash received',randomUUID()])
    }
    const paid=(await db.query<{id:string}>('select id from public.payments order by id limit 1')).rows[0].id
    await db.query("update public.payments set refund_status='pending',refund_reason='Synthetic earlier correction' where id=$1",[paid])
    await call(admin,'select public.record_payment_refund($1,$2,$3) r',[paid,'Synthetic full refund actually returned',randomUUID()])
    await db.query("update public.participants set queue_joined_at=queue_joined_at-interval '1 minute' where id=$1",[m.participant_id])
    const before=(await db.query("select r from (select to_jsonb(c) r from public.charges c union all select to_jsonb(p) from public.payments p) snapshots order by r::text")).rows
    await call(admin,'select public.verify_and_link_guest($1,$2,true,$3,$4) r',[i.guest_id,member,'Verified independent identity',randomUUID()])
    expect((await db.query("select r from (select to_jsonb(c) r from public.charges c union all select to_jsonb(p) from public.payments p) snapshots order by r::text")).rows).toEqual(before)
    const snapshot=await call(member,'select public.get_session_snapshot($1) r',[sid]);expect(snapshot.counts).toEqual({confirmed:1,held:0,waiting:0})
    await call(member,"select public.cast_session_vote($1,'pass',$2) r",[sid,randomUUID()])
    expect((await call(member,'select public.get_session_snapshot($1) r',[sid])).participation).toMatchObject({id:snapshot.participation.id,participation_status:'withdrawn_early'})
    expect((await db.query('select count(*)::int n from public.charges')).rows[0]).toEqual({n:2})
  })
})

describe('Task 7 recovery database capabilities',()=>{
  beforeAll(async()=>{db=await createIdentityDatabase()})
  beforeEach(async()=>{await db.exec('begin');for(const [i,uid] of [admin,member,suspended].entries())await db.query('insert into auth.users(id,phone,raw_user_meta_data) values($1,$2,$3)',[uid,`60112456780${i}`,{display_name:'Synthetic Recovery'}]);await db.exec("update public.memberships set status='active'");await db.query("update public.memberships set role='admin' where user_id=$1",[admin]);await db.query("update public.memberships set status='suspended' where user_id=$1",[suspended])})
  afterEach(async()=>{await db.exec('rollback')});afterAll(async()=>{await db?.close()})
  const issue=(uid=admin,target=member,verified=true)=>call(uid,'select public.issue_recovery_capability($1,$2,$3,$4,$5) r',[target,hash(1),verified,'Identity checked outside app',randomUUID()])
  it('requires active admin and independent identity verification',async()=>{await expect(issue(member)).rejects.toThrow('ADMIN_REQUIRED');await expect(issue(admin,member,false)).rejects.toThrow('IDENTITY_VERIFICATION_REQUIRED')})
  it('claims once, rejects expiry/replay and records no password',async()=>{await issue();expect(await service('select public.claim_recovery_capability($1) r',[hash(1)])).toMatchObject({user_id:member});await expect(service('select public.claim_recovery_capability($1) r',[hash(1)])).rejects.toThrow('RECOVERY_UNAVAILABLE');expect(JSON.stringify((await db.query('select safe_metadata from public.audit_logs')).rows)).not.toContain(hash(1))})
  it('rechecks issuer suspension and permits suspended target without restoring membership',async()=>{await issue(admin,suspended);await db.query("update public.memberships set status='suspended' where user_id=$1",[admin]);await expect(service('select public.claim_recovery_capability($1) r',[hash(1)])).rejects.toThrow('RECOVERY_UNAVAILABLE');await db.query("update public.memberships set status='active' where user_id=$1",[admin]);expect(await service('select public.claim_recovery_capability($1) r',[hash(1)])).toMatchObject({user_id:suspended});expect((await db.query('select status from public.memberships where user_id=$1',[suspended])).rows[0]).toEqual({status:'suspended'})})
  it('rejects expired capability and demoted issuer without exposing private tables to any client',async()=>{
    await issue();await db.exec("update app_private.recovery_tokens set created_at=now()-interval '1 hour',expires_at=now()-interval '1 second'")
    await expect(service('select public.claim_recovery_capability($1) r',[hash(1)])).rejects.toThrow('RECOVERY_UNAVAILABLE')
    await db.exec("update app_private.recovery_tokens set expires_at=now()+interval '1 minute'");await db.query("update public.memberships set role='member' where user_id=$1",[admin]);await expect(service('select public.claim_recovery_capability($1) r',[hash(1)])).rejects.toThrow('RECOVERY_UNAVAILABLE')
    for(const table of ['guest_access_tokens','guest_sessions','recovery_tokens','guest_operations','capability_budgets'])for(const role of ['authenticated','service_role'])expect((await db.query<{allowed:boolean}>('select has_table_privilege($1,$2,$3) allowed',[role,`app_private.${table}`,'select'])).rows[0].allowed).toBe(false)
  })
  it('finishes a consumed recovery once and audits provider failure without reopening capability',async()=>{
    const issued=await issue();await service('select public.claim_recovery_capability($1) r',[hash(1)])
    expect(await service('select to_jsonb(public.finish_recovery_capability($1,false)) r',[issued.recovery_id])).toBe(true)
    expect(await service('select to_jsonb(public.finish_recovery_capability($1,true)) r',[issued.recovery_id])).toBe(false)
    await expect(service('select public.claim_recovery_capability($1) r',[hash(1)])).rejects.toThrow('RECOVERY_UNAVAILABLE')
    expect((await db.query("select action from public.audit_logs where action='recovery_provider_failed'")).rows).toHaveLength(1)
  })
  it('commits attempt budgets independently of failed capability processing',async()=>{
    expect(await service("select to_jsonb(public.consume_capability_budget('synthetic:test',1)) r")).toBe(true)
    await expect(service('select public.claim_recovery_capability($1) r',[hash(8)])).rejects.toThrow('RECOVERY_UNAVAILABLE')
    expect(await service("select to_jsonb(public.consume_capability_budget('synthetic:test',1)) r")).toBe(false)
  })
})

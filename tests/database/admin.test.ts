import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it } from 'vitest'
import { createIdentityDatabase } from '../helpers/identity-db.mjs'
import { coreFixtureSql,fixtureId as id } from '../helpers/core-fixture'

let db:PGlite
const users={a:randomUUID(),b:randomUUID(),pending:randomUUID(),suspended:randomUUID(),admin:randomUUID()}
async function call<T=Record<string,unknown>>(uid:string,sql:string,args:unknown[]=[]) {
  await db.exec('savepoint admin_call')
  try{await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);const r=await db.query<{r:T}>(sql,args);await db.exec('reset role;release savepoint admin_call');return r.rows[0]?.r}
  catch(e){await db.exec('rollback to savepoint admin_call;reset role;release savepoint admin_call');throw e}
}
const change=(uid=users.admin,target=users.pending,status='active',role='member',oldStatus='pending',oldRole='member',reason='Reviewed synthetic membership',rid=randomUUID())=>call(uid,'select public.admin_set_membership($1,$2,$3,$4,$5,$6,$7) r',[target,status,role,oldStatus,oldRole,reason,rid])
const settings=(version=0,bank='Synthetic Bank',name='Synthetic Club',number='0000000000',qr:string|null=null,checked=true,rid=randomUUID(),uid=users.admin)=>call(uid,'select public.save_club_settings($1,$2,$3,$4,$5,$6,$7,$8) r',[bank,name,number,qr,version,checked,'Recipient independently checked',rid])
describe('Task 8 admin transactions and safe projections',()=>{
  beforeAll(async()=>{db=await createIdentityDatabase()})
  beforeEach(async()=>{await db.exec('begin');for(const [i,uid] of Object.values(users).entries())await db.query('insert into auth.users(id,phone,raw_user_meta_data) values($1,$2,$3)',[uid,`60112345678${i}`,{display_name:`Synthetic Admin Test ${i}`}]);await db.exec(coreFixtureSql(users))})
  afterEach(async()=>{await db.exec('rollback')});afterAll(async()=>{await db?.close()})
  it.each([users.a,users.pending,users.suspended])('denies non-admin %s dashboard, settings, member and audit access',async uid=>{
    for(const sql of ['select public.get_admin_dashboard() r','select public.get_admin_settings() r',"select public.get_admin_members('',0) r","select public.get_admin_audit('',0) r"]){await expect(call(uid,sql)).rejects.toThrow(/ADMIN_REQUIRED|MEMBERSHIP_NOT_ACTIVE/)}
    await expect(change(uid)).rejects.toThrow(/ADMIN_REQUIRED|MEMBERSHIP_NOT_ACTIVE/)
  })
  it('approves with audit/idempotency and rejects stale/conflicting requests',async()=>{
    const rid=randomUUID(),first=await change(users.admin,users.pending,'active','member','pending','member','Checked identity',rid)
    expect(first).toMatchObject({status:'active',role:'member'});expect(await change(users.admin,users.pending,'active','member','pending','member','Checked identity',rid)).toEqual(first)
    await expect(change()).rejects.toThrow('MEMBERSHIP_STALE')
    await expect(change(users.admin,users.pending,'suspended','member','active','member','Changed payload',rid)).rejects.toThrow('REQUEST_ID_CONFLICT')
    expect((await db.query("select count(*)::int n from public.audit_logs where action='membership_changed'")).rows[0]).toEqual({n:1})
  })
  it('protects self/last administrator and requires explicit reasons',async()=>{
    await expect(change(users.admin,users.admin,'suspended','admin','active','admin')).rejects.toThrow('SELF_CHANGE_DENIED')
    await expect(change(users.admin,users.pending,'active','member','pending','member','')).rejects.toThrow('REASON_REQUIRED')
    await expect(change(users.admin,users.pending,'pending','admin','pending','member')).rejects.toThrow('INVALID_MEMBERSHIP')
  })
  it('suspension immediately denies participation while retaining existing charges',async()=>{
    await change(users.admin,users.a,'suspended','member','active','member')
    await expect(call(users.a,"select public.cast_session_vote($1,'play',$2) r",[id(20),randomUUID()])).rejects.toThrow('MEMBERSHIP_NOT_ACTIVE')
    expect(await call<{id:string}[]>(users.a,'select jsonb_agg(c) r from public.charges c')).toHaveLength(1)
    await change(users.admin,users.a,'active','member','suspended','member')
    expect((await db.query('select status from public.memberships where user_id=$1',[users.a])).rows[0]).toEqual({status:'active'})
  })
  it('totals only approved receipts/cash, excludes void/superseded debt and separates actual refunds',async()=>{
    const cash=await call(users.admin,'select public.record_cash_payment($1,$2,$3) r',[id(51),'Synthetic full cash',randomUUID()])
    expect(await call(users.admin,'select public.get_admin_dashboard() r')).toMatchObject({received_sen:'2000',outstanding_sen:'4000',pending_refund_sen:'0',refunded_sen:'0',retained_sen:'2000'})
    await db.query("update public.payments set refund_status='pending',refund_reason='Synthetic correction' where id=$1",[cash.payment_id])
    expect(await call(users.admin,'select public.get_admin_dashboard() r')).toMatchObject({pending_refund_sen:'2000',refunded_sen:'0'})
    await call(users.admin,'select public.record_payment_refund($1,$2,$3) r',[cash.payment_id,'Actually returned in full',randomUUID()])
    await db.exec("update public.charges set status='voided' where id='"+id(53)+"'; update public.charges set is_current=false,status='superseded' where id='"+id(52)+"'")
    expect(await call(users.admin,'select public.get_admin_dashboard() r')).toMatchObject({received_sen:'2000',outstanding_sen:'0',refunded_sen:'2000',retained_sen:'0'})
  })
  it('settings require checked recipients, complete fields, revision and retry identity',async()=>{
    await expect(settings(0,'Synthetic Bank','Synthetic Club','0000',null,false)).rejects.toThrow('RECIPIENT_CHECK_REQUIRED')
    await expect(settings(0,'Synthetic Bank','','0000')).rejects.toThrow('INVALID_BANK_DETAILS')
    const rid=randomUUID(),saved=await settings(0,'Synthetic Bank','Synthetic Club','0000000000',null,true,rid)
    expect(saved).toMatchObject({revision:1});expect(await settings(0,'Synthetic Bank','Synthetic Club','0000000000',null,true,rid)).toEqual(saved)
    await expect(settings()).rejects.toThrow('SETTINGS_STALE')
    await expect(settings(1,'Synthetic Bank','Synthetic Club','0000','https://bad.test/qr.png')).rejects.toThrow('QR_NOT_VERIFIED')
    expect(await settings(1)).toMatchObject({revision:2})
  })
  it('bounded member/audit and guest history projections preserve original records',async()=>{
    expect(await call(users.admin,"select public.get_admin_members('Synthetic',0) r")).toMatchObject({total:5})
    await expect(call(users.admin,"select public.get_admin_members('',-1) r")).rejects.toThrow('INVALID_PAGE')
    expect(await call(users.admin,'select public.get_guest_history($1) r',[id(1)])).toMatchObject({guest:{id:id(1)},participations:[{id:id(34)}]})
    await expect(call(users.a,'select public.get_guest_history($1) r',[id(1)])).rejects.toThrow('ADMIN_REQUIRED')
    expect(await call(users.admin,"select public.get_admin_audit('',0) r")).toMatchObject({total:1})
  })
})

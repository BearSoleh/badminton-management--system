import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it } from 'vitest'
import { createIdentityDatabase } from '../helpers/identity-db.mjs'
import { coreFixtureSql,fixtureId as id } from '../helpers/core-fixture'

let db:PGlite
const users={a:randomUUID(),b:randomUUID(),pending:randomUUID(),suspended:randomUUID(),admin:randomUUID()}
let path:string
async function call<T=Record<string,unknown>>(uid:string,sql:string,args:unknown[]=[]) {
  await db.exec('savepoint payment_call')
  try {await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);const r=await db.query<{r:T}>(sql,args);await db.exec('reset role; release savepoint payment_call');return r.rows[0]?.r}
  catch(e){await db.exec('rollback to savepoint payment_call; reset role; release savepoint payment_call');throw e}
}
const submit=(p=path,r=randomUUID(),uid=users.a,c=id(51))=>call(uid,'select public.submit_payment($1,$2,$3) r',[c,p,r])
const review=(pid:string,approve=true,checked=true,reason='',r=randomUUID(),uid=users.admin)=>call(uid,'select public.review_payment($1,$2,$3,$4,$5) r',[pid,approve,checked,reason,r])
const cash=(c=id(51),r=randomUUID(),uid=users.admin)=>call(uid,'select public.record_cash_payment($1,$2,$3) r',[c,'Cash received in full',r])
const cancel=(r=randomUUID())=>call(users.admin,'select public.cancel_session($1,$2,$3) r',[id(20),'Court cancelled',r])
async function object(p=path,size=42,mime='application/pdf',owner=users.a,attest=true) {
  await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('receipts',$1,$2,$3)",[p,owner,{size,mimetype:mime}])
  if(attest)await db.query('select public.attest_receipt_upload($1,$2,$3,$4)',[p,size,mime,'a'.repeat(64)])
}

describe('Task 6 financial transitions in PostgreSQL',()=>{
  beforeAll(async()=>{db=await createIdentityDatabase();expect((await db.query("select to_regprocedure('public.submit_payment(uuid,text,uuid)') is not null installed")).rows[0]).toEqual({installed:true})})
  beforeEach(async()=>{await db.exec('begin');for(const [i,uid] of Object.values(users).entries())await db.query('insert into auth.users(id,phone,raw_user_meta_data) values($1,$2,$3)',[uid,`60112345678${i}`,{display_name:`Synthetic Payments ${i}`}]);await db.exec(coreFixtureSql(users));path=`${users.a}/${id(51)}/${randomUUID()}.pdf`})
  afterEach(async()=>{await db.exec('rollback')});afterAll(async()=>{await db?.close()})
  it('requires completed metadata, private byte attestation, path ownership and current full liability',async()=>{
    await expect(submit()).rejects.toThrow('RECEIPT_NOT_READY')
    await object(path,42,'application/pdf',users.a,false);await expect(submit()).rejects.toThrow('RECEIPT_NOT_READY')
    await db.query('select public.attest_receipt_upload($1,42,$2,$3)',[path,'application/pdf','a'.repeat(64)])
    await expect(submit(path,randomUUID(),users.b)).rejects.toThrow('CHARGE_ACCESS_DENIED')
    const r=await submit();expect(r.status).toBe('submitted')
    expect((await db.query('select status,amount_sen from public.charges where id=$1',[id(51)])).rows[0]).toEqual({status:'pending_verification',amount_sen:2000})
    await expect(submit(`${users.a}/${id(51)}/${randomUUID()}.pdf`)).rejects.toThrow('CHARGE_NOT_PAYABLE')
  })
  it.each([[0,'application/pdf'],[5242881,'application/pdf'],[42,'image/svg+xml'],[42,'text/html'],[42,'image/png']])('rejects invalid metadata %j %s',async(size,mime)=>{
    await object(path,size,mime,users.a,false)
    await expect(db.query('select public.attest_receipt_upload($1,$2,$3,$4)',[path,size,mime,'a'.repeat(64)])).rejects.toThrow('INVALID_RECEIPT')
  })
  it('accepts the inclusive 5 MiB boundary and suspended own obligations without participation privileges',async()=>{
    const p=`${users.suspended}/${id(53)}/${randomUUID()}.pdf`;await object(p,5242880,'application/pdf',users.suspended)
    expect(await submit(p,randomUUID(),users.suspended,id(53))).toMatchObject({status:'submitted',amount_sen:2000})
    await expect(call(users.suspended,'select public.join_session($1,$2) r',[id(20),randomUUID()])).rejects.toThrow('MEMBERSHIP_NOT_ACTIVE')
  })
  it('deduplicates submission and approval; requires explicit bank check and denies conflicting second decisions',async()=>{
    await object();const rid=randomUUID(),p=await submit(path,rid)
    expect(await submit(path,rid)).toEqual(p)
    await expect(review(String(p.payment_id),true,false)).rejects.toThrow('BANK_CHECK_REQUIRED')
    const r=randomUUID(),approved=await review(String(p.payment_id),true,true,'Bank reference checked',r)
    expect(await review(String(p.payment_id),true,true,'Bank reference checked',r)).toEqual(approved)
    await expect(review(String(p.payment_id))).rejects.toThrow('PAYMENT_ALREADY_REVIEWED')
    await expect(review(String(p.payment_id),false,true,'Different',r)).rejects.toThrow('REQUEST_ID_CONFLICT')
    expect((await db.query("select count(*)::int n from public.audit_logs where action='payment_approved'")).rows[0]).toEqual({n:1})
    await expect(cash()).rejects.toThrow('CHARGE_NOT_PAYABLE')
  })
  it('requires rejection reason, keeps the old submission and accepts a new receipt',async()=>{
    await object();const p=await submit();await expect(review(String(p.payment_id),false,false)).rejects.toThrow('REASON_REQUIRED')
    await review(String(p.payment_id),false,false,'No matching bank transaction')
    await expect(submit(path)).rejects.toThrow('RECEIPT_ALREADY_USED')
    const next=`${users.a}/${id(51)}/${randomUUID()}.pdf`;await object(next);await submit(next)
    expect((await db.query('select status,rejection_reason from public.payments where charge_id=$1 order by created_at,id',[id(51)])).rows).toEqual(expect.arrayContaining([{status:'rejected',rejection_reason:'No matching bank transaction'},{status:'submitted',rejection_reason:null}]))
    await expect(submit(path)).rejects.toThrow('CHARGE_NOT_PAYABLE')
  })
  it('records full cash once with an audit reason and protects received-money fields',async()=>{
    const rid=randomUUID(),p=await cash(id(51),rid);expect(await cash(id(51),rid)).toEqual(p)
    expect((await db.query('select method,status,amount_sen,verified_by from public.payments where id=$1',[p.payment_id])).rows[0]).toEqual({method:'cash',status:'approved',amount_sen:2000,verified_by:users.admin})
    await db.exec('savepoint immutable_money');await expect(db.query('update public.payments set amount_sen=1 where id=$1',[p.payment_id])).rejects.toThrow('IMMUTABLE_PAYMENT');await db.exec('rollback to savepoint immutable_money')
    await expect(call(users.a,'select public.record_cash_payment($1,$2,$3) r',[id(53),'Received',randomUUID()])).rejects.toThrow('ADMIN_REQUIRED')
  })
  it('cancels once, voids outstanding/pending liabilities, retains money and requires actual refund recording',async()=>{
    const paid=await cash();const r=randomUUID(),c=await cancel(r);expect(await cancel(r)).toEqual(c)
    expect((await db.query('select id,status from public.charges order by id')).rows).toEqual([{id:id(51),status:'paid'},{id:id(52),status:'voided'},{id:id(53),status:'voided'}])
    expect((await db.query('select status,refund_status,refunded_at from public.payments where id=$1',[paid.payment_id])).rows[0]).toEqual({status:'approved',refund_status:'pending',refunded_at:null})
    await expect(review(id(60))).rejects.toThrow('PAYMENT_ALREADY_REVIEWED')
    const rr=randomUUID(),args=[paid.payment_id,'Returned full cash amount, reference test',rr]
    const refunded=await call(users.admin,'select public.record_payment_refund($1,$2,$3) r',args)
    expect(await call(users.admin,'select public.record_payment_refund($1,$2,$3) r',args)).toEqual(refunded)
    await expect(call(users.admin,'select public.record_payment_refund($1,$2,$3) r',[paid.payment_id,'Again',randomUUID()])).rejects.toThrow('REFUND_NOT_PENDING')
    await cancel();expect((await db.query('select refund_status from public.payments where id=$1',[paid.payment_id])).rows[0]).toEqual({refund_status:'refunded'})
  })
  it('requires reasoned full-refund adjustment for paid charges and blocks unresolved pending receipts',async()=>{
    await cash();await db.query("update public.participants set attendance='present',confirmed_at=now()-interval '1 day' where session_id=$1 and participation_status='confirmed'",[id(20)])
    await db.query("update public.sessions set starts_at=now()-interval '3 hours',ends_at=now()-interval '1 hour',voting_closes_at=now()-interval '4 hours' where id=$1",[id(20)])
    await call(users.admin,'select public.save_fee_draft($1,2500,0,0,0,$2,$3) r',[id(20),'Cost correction',randomUUID()])
    const preview=()=>call(users.admin,'select public.get_fee_preview($1) r',[id(20)])
    let p=await preview()
    const adjust=(ack=true,reason='Corrected cost',token=p.review_token)=>call(users.admin,'select public.adjust_session_fee($1,2500,$2,$3,$4,$5) r',[id(20),token,reason,ack,randomUUID()])
    await expect(adjust()).rejects.toThrow('PAYMENT_REVIEW_REQUIRED')
    await db.query("update public.charges set status='pending_verification' where id=$1",[id(52)])
    await review(id(60),false,false,'Receipt not matched');p=await preview()
    await expect(adjust(false)).rejects.toThrow('REFUND_ACK_REQUIRED');await expect(adjust(true,'')).rejects.toThrow('REASON_REQUIRED')
    await adjust()
    expect((await db.query('select amount_sen,status,is_current from public.charges where participant_id=$1 order by created_at,id',[id(31)])).rows).toEqual(expect.arrayContaining([{amount_sen:2000,status:'paid',is_current:false},{amount_sen:2500,status:'unpaid',is_current:true}]))
    expect((await db.query("select amount_sen,status,refund_status from public.payments where charge_id=$1",[id(51)])).rows[0]).toEqual({amount_sen:2000,status:'approved',refund_status:'pending'})
  })
  it('denies client attestation and private helpers, foreign history and direct writes',async()=>{
    await expect(call(users.admin,'select public.attest_receipt_upload($1,42,$2,$3) r',[path,'application/pdf','a'.repeat(64)])).rejects.toThrow(/permission denied/)
    await expect(submit(path,randomUUID(),users.pending)).rejects.toThrow('MEMBERSHIP_NOT_ACTIVE')
    expect(await call(users.a,'select count(*)::int r from public.payments')).toBe(0)
    await expect(call(users.admin,"update public.payments set status='approved' returning to_jsonb(payments) r")).rejects.toThrow(/permission denied/)
  })
  it('binds attestation to completed object metadata and rejects changed/foreign receipt paths',async()=>{
    await object()
    await db.query("update storage.objects set metadata='{}' where name=$1",[path])
    await expect(submit()).rejects.toThrow('RECEIPT_NOT_READY')
    const foreign=`${users.b}/${id(51)}/${randomUUID()}.pdf`;await object(foreign,42,'application/pdf',users.b)
    await expect(submit(foreign)).rejects.toThrow('RECEIPT_NOT_READY')
    expect(await call(users.b,'select public.get_payment_history() r')).toEqual(expect.arrayContaining([expect.objectContaining({id:id(52)})]))
    expect((await call< {id:string}[] >(users.b,'select public.get_payment_history() r')).some(c=>c.id===id(51))).toBe(false)
  })
})

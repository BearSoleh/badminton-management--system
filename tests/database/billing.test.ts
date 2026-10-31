import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createIdentityDatabase } from '../helpers/identity-db.mjs'
import type { FeePreview } from '../../src/features/payments/api'

let db:PGlite
const [admin,member,pending]=[randomUUID(),randomUUID(),randomUUID()]
let sid:string, pids:string[]
async function call<T=Record<string,unknown>>(uid:string,sql:string,args:unknown[]=[]) {
  await db.exec('savepoint billing_call')
  try {
    await db.exec('set role authenticated')
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid])
    const r=await db.query<{r:T}>(sql,args)
    await db.exec('reset role; release savepoint billing_call')
    return r.rows[0]?.r
  } catch(e){await db.exec('rollback to savepoint billing_call; reset role; release savepoint billing_call');throw e}
}
const mark=(pid:string,state='present',reason='',request=randomUUID(),uid=admin)=>call(uid,'select public.set_attendance($1,$2,$3,$4) r',[pid,state,reason,request])
const draft=(fee=2000,request=randomUUID(),uid=admin)=>call(uid,'select public.save_fee_draft($1,$2,$3,$4,$5,$6,$7) r',[sid,fee,10000,3,4500,'Synthetic court and shuttle notes',request])
const preview=(uid=admin)=>call<FeePreview>(uid,'select public.get_fee_preview($1) r',[sid])
const publish=(token:string,fee=2000,reason='',request=randomUUID(),uid=admin)=>call(uid,'select public.publish_session_fee($1,$2,$3,$4,$5) r',[sid,fee,token,reason,request])
async function ready(fee=2000) { await mark(pids[0]);await mark(pids[1],'no_show');await draft(fee);return preview() }

describe('attendance and manual fee publication in PostgreSQL',()=>{
  beforeAll(async()=>{
    db=await createIdentityDatabase()
    expect((await db.query("select to_regprocedure('public.set_attendance(uuid,text,text,uuid)') is not null installed")).rows[0]).toEqual({installed:true})
  })
  beforeEach(async()=>{
    await db.exec('begin')
    for(const [i,uid] of [admin,member,pending].entries())await db.query('insert into auth.users(id,phone,raw_user_meta_data) values($1,$2,$3)',[uid,`60112345678${i}`,{display_name:`Synthetic Billing ${i}`}])
    await db.query("update public.memberships set status='active' where user_id<>$1",[pending])
    await db.query("update public.memberships set role='admin' where user_id=$1",[admin])
    sid=randomUUID();pids=[]
    await db.query("insert into public.sessions(id,title,venue,starts_at,ends_at,capacity,voting_closes_at,operational_status,created_by) values($1,'Synthetic Billing','Test court',now()-interval '3 hours',now()-interval '1 hour',10,now()-interval '4 hours','joining_open',$2)",[sid,admin])
    for(const [i,state] of ['confirmed','confirmed','late_cancelled','withdrawn_early','waitlisted','offer_declined','offer_expired','offered'].entries()) {
      const pl=randomUUID(),pid=randomUUID();pids.push(pid)
      if(i===0)await db.query('insert into public.players(id,user_id) values($1,$2)',[pl,member])
      else {
        const g=randomUUID()
        await db.query('insert into public.guests(id,name,phone,verified_by) values($1,$2,$3,$4)',[g,`Synthetic Player ${i}`,`+6011234500${i}`,admin])
        await db.query('insert into public.players(id,guest_id) values($1,$2)',[pl,g])
      }
      await db.query("insert into public.participants(id,session_id,player_id,source,participation_status,attendance,confirmed_at,charge_percent,liability_percent) values($1,$2,$3,'admin',$4,$5,case when $6 then now()-interval '1 day' end,$7,$8)",[pid,sid,pl,state,i<2?'unmarked':'not_applicable',i<4,i<2?100:i===2?75:0,i===2?75:0])
    }
  })
  afterEach(async()=>{await db.exec('rollback')})
  afterAll(async()=>{await db?.close()})
  it('requires each confirmed player to be reviewed, without automatically marking no-shows',async()=>{
    await draft();const p=await preview()
    expect(p.unmarked_count).toBe(2)
    await expect(publish(p.review_token)).rejects.toThrow('ATTENDANCE_UNMARKED')
    expect((await db.query('select count(*)::int n from public.fee_versions')).rows[0]).toEqual({n:0})
    expect((await db.query('select billing_status from public.sessions where id=$1',[sid])).rows[0]).toEqual({billing_status:'not_published'})
  })
  it('only eligible confirmed participants can be present or no-show; corrections require reasons and audit',async()=>{
    for(const pid of pids.slice(2))await expect(mark(pid,'no_show')).rejects.toThrow('ATTENDANCE_NOT_ELIGIBLE')
    await expect(mark(pids[0],'not_applicable')).rejects.toThrow('INVALID_ATTENDANCE')
    await mark(pids[0]);await expect(mark(pids[0],'no_show')).rejects.toThrow('REASON_REQUIRED')
    await mark(pids[0],'no_show','Corrected after roster review')
    expect((await db.query("select reason from public.audit_logs where action='attendance_set' order by created_at,id")).rows).toHaveLength(2)
    await db.query("update public.sessions set starts_at=now()+interval '1 day',ends_at=now()+interval '2 days' where id=$1",[sid])
    await expect(mark(pids[1])).rejects.toThrow('ATTENDANCE_NOT_OPEN')
  })
  it.each([[2000,1500],[2001,1501],[2,2],[0,0],[2147483647,1610612735]])('publishes fee/late sen pair %j',async(fee,late)=>{
    const p=await ready(fee)
    expect(pids.map(pid=>p.rows.find(r=>r.participant_id===pid)!.amount_sen)).toEqual([fee,fee,late,0,0,0,0,0])
    const r=await publish(p.review_token,fee)
    expect(r.version).toBe(1)
    expect((await db.query('select percent,amount_sen from public.charges order by created_at,id')).rows).toHaveLength(8)
    const own=await call(member,'select to_jsonb(c) r from public.charges c where participant_id=$1',[pids[0]])
    expect(own).toMatchObject({amount_sen:fee,percent:100,eligibility_snapshot:{attendance:'present',participation_status:'confirmed'}})
    expect((await db.query('select cost_snapshot from app_private.fee_cost_snapshots')).rows[0]).toMatchObject({cost_snapshot:{court_cost_sen:10000,shuttle_cost_sen:4500,shuttle_quantity:3,notes:'Synthetic court and shuttle notes'}})
    expect((await db.query('select operational_status,billing_status from public.sessions where id=$1',[sid])).rows[0]).toEqual({operational_status:'completed',billing_status:'published'})
  })
  it('preserves a retained 75% obligation after rejoin, but cancellation overrides all liability',async()=>{
    await db.query('update public.participants set liability_percent=75 where id=$1',[pids[4]])
    const p=await ready(2001);expect(p.rows.find(r=>r.participant_id===pids[4])).toMatchObject({percent:75,amount_sen:1501})
    await db.query("update public.sessions set operational_status='cancelled' where id=$1",[sid])
    const cancelled=await preview();expect(cancelled.rows.every(r=>r.amount_sen===0)).toBe(true)
    await expect(publish(cancelled.review_token,2001)).rejects.toThrow('FEE_PUBLICATION_NOT_OPEN')
  })
  it('rejects negative/fractional money, missing drafts and publication before play ends',async()=>{
    await expect(draft(-1)).rejects.toThrow('INVALID_FEE')
    await expect(draft(20.01)).rejects.toThrow()
    await expect(publish((await preview()).review_token)).rejects.toThrow('FEE_NOT_SET')
    const p=await ready()
    await db.query("update public.sessions set ends_at=now()+interval '1 hour' where id=$1",[sid])
    await expect(publish(p.review_token)).rejects.toThrow('FEE_PUBLICATION_NOT_OPEN')
  })
  it('rejects publication when attendance or draft changed after preview',async()=>{
    const p=await ready();await mark(pids[0],'no_show','Roster correction')
    await expect(publish(p.review_token)).rejects.toThrow('FEE_PREVIEW_STALE')
    const p2=await preview();await draft(2001)
    await expect(publish(p2.review_token)).rejects.toThrow('FEE_PREVIEW_STALE')
  })
  it('deduplicates publication/attendance/draft retries, rejects changed UUID payloads',async()=>{
    const rid=randomUUID(),first=await mark(pids[0],'present','',rid)
    expect(await mark(pids[0],'present','',rid)).toEqual(first)
    await expect(mark(pids[0],'no_show','Changed',rid)).rejects.toThrow('REQUEST_ID_CONFLICT')
    const dr=randomUUID();expect(await draft(2000,dr)).toEqual(await draft(2000,dr))
    await mark(pids[1],'no_show');const p=await preview(),request=randomUUID()
    const r=await publish(p.review_token,2000,'',request)
    expect(await publish(p.review_token,2000,'',request)).toEqual(r)
    await expect(publish(p.review_token,2001,'',request)).rejects.toThrow('REQUEST_ID_CONFLICT')
    expect((await db.query("select count(*)::int n from public.audit_logs where action='session_fee_published'")).rows[0]).toEqual({n:1})
    await expect(publish(p.review_token,2000,'Duplicate with new ID')).rejects.toThrow('FEE_PREVIEW_STALE')
  })
  it('creates a new reasoned version and charge chain without mutating old amounts or eligibility',async()=>{
    const p=await ready();const first=await publish(p.review_token)
    await mark(pids[0],'no_show','Actual attendance correction')
    await draft(2001);const next=await preview()
    await expect(publish(next.review_token,2001)).rejects.toThrow('REASON_REQUIRED')
    expect((await publish(next.review_token,2001,'Corrected full fee')).version).toBe(2)
    const charges=await db.query<{amount_sen:number;is_current:boolean;eligibility_snapshot:unknown;supersedes_charge_id:string|null}>('select amount_sen,is_current,eligibility_snapshot,supersedes_charge_id from public.charges where participant_id=$1 order by created_at,id',[pids[0]])
    expect(charges.rows).toHaveLength(2)
    expect(charges.rows.find(r=>!r.is_current)).toMatchObject({amount_sen:2000,eligibility_snapshot:{attendance:'present'}})
    expect(charges.rows.find(r=>r.is_current)).toMatchObject({amount_sen:2001,eligibility_snapshot:{attendance:'no_show'}})
    await expect(db.query('update public.fee_versions set full_fee_sen=1 where id=$1',[first.fee_version_id])).rejects.toThrow('IMMUTABLE_FEE_VERSION')
  })
  it('blocks replacement of payment-linked charges and immutable financial field edits',async()=>{
    const p=await ready();await publish(p.review_token)
    const c=(await db.query<{id:string}>('select id from public.charges where participant_id=$1',[pids[0]])).rows[0]
    await db.query("insert into public.payments(charge_id,method,amount_sen,submitted_by,idempotency_key) values($1,'cash',2000,$2,$3)",[c.id,admin,randomUUID()])
    await draft(2001);await expect(publish((await preview()).review_token,2001,'Correction')).rejects.toThrow('PAYMENT_ADJUSTMENT_REQUIRED')
    await db.exec('savepoint immutable')
    await expect(db.query('update public.charges set amount_sen=1 where id=$1',[c.id])).rejects.toThrow('IMMUTABLE_CHARGE_SNAPSHOT')
    await db.exec('rollback to savepoint immutable')
  })
  it('denies non-admin/pending/suspended/anonymous writes and foreign reads at the backend',async()=>{
    await expect(mark(pids[0],'present','',randomUUID(),member)).rejects.toThrow('ADMIN_REQUIRED')
    await expect(draft(2000,randomUUID(),pending)).rejects.toThrow('MEMBERSHIP_NOT_ACTIVE')
    await expect(preview(member)).rejects.toThrow('ADMIN_REQUIRED')
    await expect(call(member,"update public.participants set attendance='no_show' where id=$1 returning to_jsonb(participants) r",[pids[1]])).rejects.toThrow(/permission denied/)
    const p=await ready();await publish(p.review_token)
    expect((await call(member,'select count(*)::int r from public.charges'))).toBe(1)
    expect((await call(member,'select count(*)::int r from public.session_costs'))).toBe(0)
    await expect(call(admin,'select count(*)::int r from app_private.fee_cost_snapshots')).rejects.toThrow(/permission denied/)
    await db.query("update public.memberships set status='suspended' where user_id=$1",[member])
    expect(await call(member,'select count(*)::int r from public.charges')).toBe(1)
    await db.query("update public.memberships set status='suspended' where user_id=$1",[admin])
    await expect(draft()).rejects.toThrow('MEMBERSHIP_NOT_ACTIVE')
    const grants=await db.query("select has_function_privilege('anon','public.publish_session_fee(uuid,integer,text,text,uuid)','execute') anon,has_function_privilege('service_role','public.publish_session_fee(uuid,integer,text,text,uuid)','execute') backend")
    expect(grants.rows[0]).toEqual({anon:false,backend:false})
  })
})

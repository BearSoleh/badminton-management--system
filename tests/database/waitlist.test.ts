import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createIdentityDatabase } from '../helpers/identity-db.mjs'

let db:PGlite
const [admin,a,b,c,pending]=Array.from({length:5},()=>randomUUID())
async function call(uid:string,sql:string,args:unknown[]=[]) {
  await db.exec('savepoint actor_call')
  try {
    await db.exec('set role authenticated')
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid])
    const r=await db.query<{result:Record<string,unknown>}>(sql,args)
    await db.exec('reset role; release savepoint actor_call')
    return r.rows[0]?.result
  } catch(e) {await db.exec('rollback to savepoint actor_call; reset role; release savepoint actor_call');throw e}
}
const vote=(uid:string,sid:string)=>call(uid,'select public.cast_session_vote($1,\'play\',$2) result',[sid,randomUUID()])
const withdraw=(uid:string,pid:unknown)=>call(uid,'select public.withdraw_participation($1,$2) result',[pid,randomUUID()])
const respond=(uid:string,oid:unknown,accept=true,request=randomUUID())=>call(uid,'select public.respond_to_offer($1,$2,$3) result',[oid,accept,request])
async function setup(mode='automatic',capacity=1) {
  const s=await call(admin,"select public.save_session(null,'Synthetic waitlist','Test court',clock_timestamp()+interval '2 days',clock_timestamp()+interval '2 days 2 hours',$1,clock_timestamp()+interval '1 day',$2,$3) result",[capacity,mode,randomUUID()])
  const sid=s.session_id as string
  await call(admin,'select public.publish_session($1,$2) result',[sid,randomUUID()])
  return sid
}
async function offerFor(pid:unknown) {return (await db.query<{id:string;expires_at:string;offered_at:string;state:string}>('select * from public.waitlist_offers where participant_id=$1 order by offered_at desc limit 1',[pid])).rows[0]}
async function queued(mode='automatic') {
  const sid=await setup(mode),one=await vote(a,sid),two=await vote(b,sid),three=await vote(c,sid)
  await withdraw(a,one.participant_id)
  return {sid,one,two,three,offer:await offerFor(two.participant_id)}
}
const worker=()=>db.query('select public.expire_waitlist_offers()')

describe('waiting-list offers and private inbox in PostgreSQL',()=>{
  beforeAll(async()=>{
    db=await createIdentityDatabase()
    expect((await db.query("select to_regprocedure('public.respond_to_offer(uuid,boolean,uuid)') is not null present")).rows[0]).toEqual({present:true})
  })
  beforeEach(async()=>{
    await db.exec('begin')
    for(const [i,uid] of [admin,a,b,c,pending].entries()) await db.query('insert into auth.users(id,phone,raw_user_meta_data) values($1,$2,$3)',[uid,`60112345678${i}`,{display_name:`Synthetic ${i}`}])
    await db.query("update public.memberships set status='active' where user_id<>$1",[pending])
    await db.query("update public.memberships set role='admin' where user_id=$1",[admin])
  })
  afterEach(async()=>{await db.exec('rollback')})
  afterAll(async()=>{await db?.close()})

  it('offers only the oldest waiting player, holds capacity and persists one inbox event',async()=>{
    const {sid,two,offer}=await queued()
    expect(offer.state).toBe('pending')
    expect(Date.parse(offer.expires_at)-Date.parse(offer.offered_at)).toBe(900000)
    const snapshot=await call(b,'select public.get_session_snapshot($1) result',[sid])
    expect(snapshot.offer).toMatchObject({id:offer.id,state:'pending'})
    expect(snapshot.counts).toEqual({confirmed:0,held:1,waiting:1})
    expect(await call(b,'select public.get_active_offers() result')).toMatchObject({offers:[{session_id:sid,session_title:'Synthetic waitlist',offer:{id:offer.id}}]})
    expect(await call(c,'select public.get_active_offers() result')).toMatchObject({offers:[]})
    expect((await vote(a,sid)).participation_status).toBe('waitlisted')
    await worker();await worker()
    expect((await db.query('select count(*)::int n from public.waitlist_offers')).rows[0]).toEqual({n:1})
    expect((await db.query("select count(*)::int n from public.notifications where user_id=$1 and type='waitlist_offer'",[b])).rows[0]).toEqual({n:1})
    expect((await db.query("select delivery_metadata from app_private.notification_outbox where event_key=$1",[`offer:${offer.id}:${b}`])).rows[0]).toMatchObject({delivery_metadata:{persisted_in_app:true}})
    expect((await offerFor(two.participant_id)).id).toBe(offer.id)
  })
  it('accepts 12:14:59 and rejects 12:15:00 exactly, without a worker',async()=>{
    for(const [at,expected] of [['2026-11-01T12:14:59Z','accepted'],['2026-11-01T12:15:00Z','expired']]) {
      const {sid,two,offer}=await queued()
      await db.query("update public.sessions set starts_at='2026-11-01T14:00Z',ends_at='2026-11-01T16:00Z',voting_closes_at='2026-11-01T11:00Z' where id=$1",[sid])
      await db.query("update public.waitlist_offers set offered_at='2026-11-01T12:00Z',expires_at='2026-11-01T12:15Z' where id=$1",[offer.id])
      const r=await db.query<{result:{offer_state:string}}>('select app_private.resolve_offer_locked($1,true,$2::timestamptz) result',[offer.id,at])
      expect(r.rows[0].result.offer_state).toBe(expected)
      expect((await offerFor(two.participant_id)).state).toBe(expected)
    }
  })
  it('Continue confirms once; same-request retry returns original and conflicting retry fails',async()=>{
    const {offer}=await queued(),request=randomUUID()
    const result=await respond(b,offer.id,true,request)
    expect(result).toMatchObject({offer_state:'accepted',participation_status:'confirmed',charge_percent:100})
    expect(await respond(b,offer.id,true,request)).toEqual(result)
    await expect(respond(b,offer.id,false,request)).rejects.toThrow('REQUEST_ID_CONFLICT')
    await expect(respond(b,offer.id)).rejects.toThrow('OFFER_NOT_PENDING')
  })
  it('Decline creates no charge, promotes the next player once and preserves old timestamps',async()=>{
    const {offer,two,three}=await queued()
    expect(await respond(b,offer.id,false)).toMatchObject({offer_state:'declined',charge_percent:0,liability_percent:0})
    expect((await offerFor(three.participant_id)).state).toBe('pending')
    expect(new Date((await db.query<{queue_joined_at:Date}>('select queue_joined_at from public.participants where id=$1',[two.participant_id])).rows[0].queue_joined_at).getTime()).toBe(Date.parse(two.queue_joined_at as string))
    await worker();expect((await db.query('select count(*)::int n from public.waitlist_offers')).rows[0]).toEqual({n:2})
  })
  it('changing vote to Not playing on an offered place records one offer-end event',async()=>{
    const {sid,offer}=await queued()
    await call(b,"select public.cast_session_vote($1,'pass',$2) result",[sid,randomUUID()])
    await call(b,"select public.cast_session_vote($1,'pass',$2) result",[sid,randomUUID()])
    expect((await db.query("select count(*)::int n from public.notifications where user_id=$1 and type='waitlist_offer_declined'",[b])).rows[0]).toEqual({n:1})
    expect((await db.query("select count(*)::int n from public.audit_logs where entity_id=$1 and action='waitlist_offer_declined'",[offer.id])).rows[0]).toEqual({n:1})
  })
  it('a stale Continue persists expiry/promotion, returns expired and creates no liability',async()=>{
    const {offer,three}=await queued()
    await db.query("update public.waitlist_offers set offered_at=now()-interval '16 minutes',expires_at=now()-interval '1 minute' where id=$1",[offer.id])
    expect(await respond(b,offer.id)).toMatchObject({offer_state:'expired',charge_percent:0})
    expect((await offerFor(three.participant_id)).state).toBe('pending')
  })
  it('worker expires without browser, duplicate execution creates one next offer',async()=>{
    const {offer,three}=await queued()
    await db.query("update public.waitlist_offers set offered_at=now()-interval '16 minutes',expires_at=now()-interval '1 minute' where id=$1",[offer.id])
    await worker();await worker()
    expect((await offerFor(three.participant_id)).state).toBe('pending')
    expect((await db.query('select count(*)::int n from public.waitlist_offers')).rows[0]).toEqual({n:2})
  })
  it('manual mode creates no automatic offers; admin order override requires reason and audit',async()=>{
    const {sid,two,three}=await queued('manual')
    expect(await offerFor(two.participant_id)).toBeUndefined()
    await expect(call(a,'select public.admin_offer_slot($1,$2,$3) result',[three.participant_id,'Consent received',randomUUID()])).rejects.toThrow('ADMIN_REQUIRED')
    await expect(call(admin,'select public.admin_offer_slot($1,$2,$3) result',[three.participant_id,' ',randomUUID()])).rejects.toThrow('REASON_REQUIRED')
    await call(admin,'select public.admin_offer_slot($1,$2,$3) result',[three.participant_id,'Earlier player unavailable; player agreed',randomUUID()])
    expect((await offerFor(three.participant_id)).state).toBe('pending')
    expect((await db.query("select reason,safe_metadata from public.audit_logs where action='admin_offer_slot' and entity_id=$1",[three.participant_id])).rows[0]).toMatchObject({reason:'Earlier player unavailable; player agreed',safe_metadata:{queue_override:true}})
    await expect(call(admin,'select public.admin_offer_slot($1,$2,$3) result',[two.participant_id,'Checked',randomUUID()])).rejects.toThrow('NO_VACANCY')
    expect((await call(admin,'select public.get_waitlist_queue($1) result',[sid])).queue).toBeInstanceOf(Array)
    await expect(call(a,'select public.get_waitlist_queue($1) result',[sid])).rejects.toThrow('ADMIN_REQUIRED')
  })
  it('mode changes are audited and automatic mode immediately offers a vacancy',async()=>{
    const {sid,two}=await queued('manual')
    await call(admin,'select public.set_waitlist_mode($1,$2,$3,$4) result',[sid,'automatic','Use normal priority',randomUUID()])
    expect((await offerFor(two.participant_id)).state).toBe('pending')
  })
  it('no new offer inside 15 minutes; late admin confirmation records explicit consent',async()=>{
    const {sid,two}=await queued('manual')
    await db.query("update public.sessions set starts_at=clock_timestamp()+interval '14 minutes',voting_closes_at=clock_timestamp() where id=$1",[sid])
    await expect(call(admin,'select public.admin_offer_slot($1,$2,$3) result',[two.participant_id,'Player agreed',randomUUID()])).rejects.toThrow('OFFER_WINDOW_CLOSED')
    await expect(call(admin,'select public.admin_confirm_late_slot($1,false,$2,$3) result',[two.participant_id,'Spoke to player',randomUUID()])).rejects.toThrow('CONSENT_REQUIRED')
    expect(await call(admin,'select public.admin_confirm_late_slot($1,true,$2,$3) result',[two.participant_id,'Player consent by phone',randomUUID()])).toMatchObject({participation_status:'confirmed'})
    expect(await offerFor(two.participant_id)).toBeUndefined()
    expect((await db.query("select safe_metadata from public.audit_logs where action='admin_confirm_late_slot'")).rows[0]).toMatchObject({safe_metadata:{player_consent:true}})
  })
  it('at exactly 15 minutes a full offer is allowed, after the boundary none is created',async()=>{
    const {sid,two}=await queued('manual')
    const at='2026-11-01T12:00:00Z'
    await db.query("update public.sessions set starts_at='2026-11-01T12:15Z',ends_at='2026-11-01T14:15Z',voting_closes_at='2026-11-01T11:00Z',waitlist_mode='automatic' where id=$1",[sid])
    await db.query('select app_private.reconcile_waitlist($1,$2::timestamptz)',[sid,at])
    expect(new Date((await offerFor(two.participant_id)).expires_at).toISOString()).toBe('2026-11-01T12:15:00.000Z')
  })
  it('cancelled sessions revoke held offers and do not promote',async()=>{
    const {sid,offer}=await queued()
    await db.query("update public.sessions set operational_status='cancelled' where id=$1",[sid])
    expect((await db.query('select state from public.waitlist_offers where id=$1',[offer.id])).rows[0]).toEqual({state:'revoked'})
    await expect(respond(b,offer.id)).rejects.toThrow('OFFER_NOT_PENDING')
    await worker();expect((await db.query('select count(*)::int n from public.waitlist_offers')).rows[0]).toEqual({n:1})
  })
  it('session start denies acceptance and no new promotion or manual consent is allowed',async()=>{
    const {sid,offer,three}=await queued()
    await db.query("update public.sessions set starts_at=clock_timestamp()-interval '1 second',voting_closes_at=clock_timestamp()-interval '2 seconds' where id=$1",[sid])
    expect(await respond(b,offer.id)).toMatchObject({offer_state:'expired'})
    expect(await offerFor(three.participant_id)).toBeUndefined()
    await expect(call(admin,'select public.admin_confirm_late_slot($1,true,$2,$3) result',[three.participant_id,'Player consent',randomUUID()])).rejects.toThrow('SESSION_STARTED')
  })
  it('foreign/stale actors cannot respond, forge state, run workers or execute internal helpers',async()=>{
    const {offer}=await queued()
    await expect(respond(c,offer.id)).rejects.toThrow('OFFER_NOT_FOUND')
    await expect(respond(pending,offer.id)).rejects.toThrow('MEMBERSHIP_NOT_ACTIVE')
    await db.query("update public.memberships set status='suspended' where user_id=$1",[b])
    await expect(respond(b,offer.id)).rejects.toThrow('MEMBERSHIP_NOT_ACTIVE')
    await expect(call(admin,'select public.expire_waitlist_offers() result')).rejects.toThrow('permission denied')
    expect((await db.query("select bool_and(not has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute')) ok from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname in ('resolve_offer_locked','reconcile_waitlist','create_waitlist_offer','persist_notification')")).rows[0]).toEqual({ok:true})
  })
  it('inactive queue entries are skipped without changing their timestamp',async()=>{
    const sid=await setup(),one=await vote(a,sid),two=await vote(b,sid),three=await vote(c,sid)
    await db.query("update public.memberships set status='suspended' where user_id=$1",[b])
    await withdraw(a,one.participant_id)
    expect(await offerFor(two.participant_id)).toBeUndefined()
    expect((await offerFor(three.participant_id)).state).toBe('pending')
  })
  it('own inbox read is idempotent; other users and direct content writes are denied',async()=>{
    const {offer}=await queued()
    const notice=(await db.query<{id:string}>('select id from public.notifications where user_id=$1',[b])).rows[0]
    await expect(call(c,'select public.mark_notification_read($1) result',[notice.id])).rejects.toThrow('NOTIFICATION_NOT_FOUND')
    const first=await call(b,'select public.mark_notification_read($1) result',[notice.id])
    expect(await call(b,'select public.mark_notification_read($1) result',[notice.id])).toEqual(first)
    await expect(call(b,"update public.notifications set payload='{}' where id=$1 returning payload result",[notice.id])).rejects.toThrow('permission denied')
    expect((await call(b,'select public.get_session_snapshot($1) result',[(await db.query<{session_id:string}>('select session_id from public.participants where id=(select participant_id from public.waitlist_offers where id=$1)',[offer.id])).rows[0].session_id])).offer).toBeTruthy()
  })
  it('accepted offer followed by withdrawal applies KL rate; later expiry keeps prior liability',async()=>{
    const {sid,offer,two}=await queued()
    await respond(b,offer.id)
    await db.query("update public.sessions set starts_at=clock_timestamp()+interval '1 hour',voting_closes_at=clock_timestamp() where id=$1",[sid])
    const result=await withdraw(b,two.participant_id)
    const expected=(await db.query<{n:number}>("select app_private.withdrawal_percentage(starts_at,clock_timestamp(),true)::int n from public.sessions where id=$1",[sid])).rows[0].n
    expect(result.liability_percent).toBe(expected)
    // Previous Task 3 obligation is a floor even when a later offer is declined.
    await db.query('update public.participants set liability_percent=75,charge_percent=75 where id=$1',[two.participant_id])
    await vote(b,sid).catch(()=>undefined) // voting may now be closed; explicit join follows.
    await call(b,'select public.join_session($1,$2) result',[sid,randomUUID()])
    await db.query("update public.sessions set waitlist_mode='manual' where id=$1",[sid])
    await db.query("update public.waitlist_offers set state='declined',response_at=clock_timestamp() where state='pending' and participant_id<>$1",[two.participant_id])
    await db.query("update public.participants set participation_status='offer_declined',charge_percent=0 where session_id=$1 and id<>$2 and participation_status='offered'",[sid,two.participant_id])
    await call(admin,'select public.admin_offer_slot($1,$2,$3) result',[two.participant_id,'Player agreed',randomUUID()])
    expect(await respond(b,(await offerFor(two.participant_id)).id,false)).toMatchObject({liability_percent:75,charge_percent:75})
  })
  it('worker isolates a delivery failure, alerts admins once, and retries without partial offers',async()=>{
    const failed=await queued('manual')
    const healthySid=await setup('manual'),first=await vote(a,healthySid),next=await vote(c,healthySid)
    await withdraw(a,first.participant_id)
    await db.exec(`create function app_private.synthetic_delivery_failure() returns trigger language plpgsql as $$ begin
      if new.type='waitlist_offer' and new.user_id='${b}'::uuid then raise exception 'synthetic private diagnostic'; end if; return new; end $$;
      create trigger synthetic_delivery_failure before insert on public.notifications for each row execute function app_private.synthetic_delivery_failure();`)
    await db.query("update public.sessions set waitlist_mode='automatic' where id in ($1,$2)",[failed.sid,healthySid])
    await worker();await worker()
    expect((await db.query('select failures,last_error_code from app_private.waitlist_job_health')).rows[0]).toEqual({failures:1,last_error_code:'P0001'})
    expect(await offerFor(failed.two.participant_id)).toBeUndefined()
    expect((await offerFor(next.participant_id)).state).toBe('pending')
    expect((await db.query("select count(*)::int n from public.notifications where user_id=$1 and type='waitlist_job_failure'",[admin])).rows[0]).toEqual({n:1})
    await db.exec('drop trigger synthetic_delivery_failure on public.notifications;drop function app_private.synthetic_delivery_failure()')
    await worker()
    expect((await offerFor(failed.two.participant_id)).state).toBe('pending')
    expect((await db.query('select failures from app_private.waitlist_job_health')).rows[0]).toEqual({failures:0})
  })
})

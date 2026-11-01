import { randomBytes,randomUUID } from 'node:crypto'
import { afterAll,beforeAll,describe,expect,it } from 'vitest'
import { guestFixture } from '../helpers/guest-fixture'
import { localSql,sqlLiteral as q } from '../helpers/local-sql'
import { receiptPdf } from '../helpers/payment-fixture'
import { holdSession } from '../helpers/financial-lock'
import { runtimeLogsContain } from '../helpers/runtime-logs'

let f:Awaited<ReturnType<typeof guestFixture>>
describe('real Task 7 scoped guest backend',()=>{
  beforeAll(async()=>{f=await guestFixture()});afterAll(async()=>{await f?.cleanup()})
  it('exchanges once, never treats phone/name as credentials and denies invalid/revoked/expired scope',async()=>{
    const sid=await f.session(),i=await f.invite(sid),session=await f.exchange(i.token)
    expect((await f.endpoint('guest-access',{action:'exchange',token:i.token})).status).toBe(403)
    expect((await f.endpoint('guest-access',{action:'snapshot',name:'Synthetic Guest',phone:'+60112345678'})).status).toBe(403)
    expect((await f.action(randomBytes(32).toString('base64url'),'snapshot')).status).toBe(403)
    expect((await (await f.action(session,'snapshot')).json()).session.id).toBe(sid)
    const r=await f.actors[0].client.rpc('revoke_guest_invitation',{token_id_input:i.token_id,reason_input:'Synthetic revocation',request_id:randomUUID()});expect(r.error).toBeNull()
    expect((await f.action(session,'snapshot')).status).toBe(403)
    const next=await f.invite(sid,i.guest_id)
    localSql(`update app_private.guest_access_tokens set created_at=clock_timestamp()-interval '31 days',expires_at=clock_timestamp()-interval '1 second' where id=${q(next.token_id)}`)
    expect((await f.endpoint('guest-access',{action:'exchange',token:next.token})).status).toBe(403)
  })
  it('atomically limits concurrent confirmed reservations across different sessions',async()=>{
    const sids=await Promise.all([f.session(),f.session(),f.session()]),i=await f.invite(sids[0]),one=await f.exchange(i.token)
    expect((await f.action(one,'join')).status).toBe(200)
    const i2=await f.invite(sids[1],i.guest_id),i3=await f.invite(sids[2],i.guest_id),two=await f.exchange(i2.token),three=await f.exchange(i3.token)
    const release=await holdSession(sids[1]),release2=await holdSession(sids[2])
    const calls=[f.action(two,'join'),f.action(three,'join')]
    try {
      const until=Date.now()+7000;let blocked=0
      while(Date.now()<until){blocked=Number(localSql("select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%guest_portal_action%';"));if(blocked>=2)break;await new Promise(r=>setTimeout(r,50))}
      expect(blocked).toBeGreaterThanOrEqual(2)
    }finally{await release();await release2()}
    const results=await Promise.all(calls);expect(results.map(r=>r.status).sort()).toEqual([200,400]);expect(await results.find(r=>r.status===400)!.json()).toEqual({error:'GUEST_ACCOUNT_REQUIRED'})
    expect(localSql(`select count(*) from public.participants p join public.players pl on pl.id=p.player_id where pl.guest_id=${q(i.guest_id)} and participation_status='confirmed'`)).toBe('2')
    expect((await f.action(one,'withdraw')).status).toBe(200)
    const rejected=results[0].status===400?two:three;expect((await f.action(rejected,'join')).status).toBe(200)
  })
  it('uses the same private byte checks, idempotent full submission, bank approval and linked receipt authorization',async()=>{
    const sid=await f.session(),i=await f.invite(sid),session=await f.exchange(i.token),charge=await f.ready(sid,session),rid=randomUUID()
    const body={action:'submit',chargeId:charge.id,requestId:rid,file:Buffer.from(receiptPdf).toString('base64'),mime:'application/pdf',extension:'pdf'}
    expect((await f.endpoint('guest-access',{...body,file:Buffer.from('<html>bad</html>').toString('base64')},undefined,session)).status).toBe(400)
    expect((await f.endpoint('guest-access',{...body,chargeId:randomUUID()},undefined,session)).status).toBe(403)
    const submitted=await f.endpoint('guest-access',body,undefined,session);expect(submitted.status).toBe(200);const payment=await submitted.json()
    expect(await (await f.endpoint('guest-access',body,undefined,session)).json()).toEqual(payment)
    expect((await f.endpoint('guest-access',{...body,file:Buffer.from('%PDF-1.4\nDifferent valid file\n%%EOF').toString('base64')},undefined,session)).status).toBe(400)
    const p=(await f.operator.from('payments').select('*').eq('id',payment.payment_id).single()).data!
    const path=p.receipt_object_path!;expect(p.submitted_by).toBeNull()
    expect((await f.actors[1].client.rpc('authorize_receipt_view',{object_path_input:path})).error?.message).toBe('RECEIPT_ACCESS_DENIED')
    expect((await f.actors[0].client.rpc('authorize_receipt_view',{object_path_input:path})).data).toBe(path)
    const receipt=await f.action(session,'receipt',{path});expect(receipt.status).toBe(200);const url=(await receipt.json()).url
    expect(await (await fetch(url)).arrayBuffer()).toEqual(receiptPdf.buffer)
    expect((await f.action(session,'receipt',{path:`${i.guest_id}/${randomUUID()}/${randomUUID()}.pdf`})).status).toBe(403)
    const secondSid=await f.session(),secondInvite=await f.invite(secondSid,i.guest_id),secondSession=await f.exchange(secondInvite.token),secondCharge=await f.ready(secondSid,secondSession)
    const second=await f.endpoint('guest-access',{...body,chargeId:secondCharge.id,requestId:randomUUID()},undefined,secondSession);expect(second.status).toBe(200)
    const secondPayment=await second.json(),secondPath=(await f.operator.from('payments').select('receipt_object_path').eq('id',secondPayment.payment_id).single()).data!.receipt_object_path!
    expect((await f.action(session,'receipt',{path:secondPath})).status).toBe(403)
    expect((await f.endpoint('guest-access',{...body,chargeId:secondCharge.id,requestId:randomUUID()},undefined,session)).status).toBe(403)
    expect((await f.actors[0].client.rpc('review_payment',{payment_id_input:p.id,approve_input:true,bank_checked_input:false,reason_input:'',request_id:randomUUID()})).error?.message).toBe('BANK_CHECK_REQUIRED')
    expect((await f.actors[0].client.rpc('review_payment',{payment_id_input:p.id,approve_input:true,bank_checked_input:true,reason_input:'Synthetic bank checked',request_id:randomUUID()})).error).toBeNull()
    const before=JSON.stringify(p),link=await f.actors[0].client.rpc('verify_and_link_guest',{guest_id_input:i.guest_id,user_id_input:f.actors[1].uid,verified_input:true,reason_input:'Verified outside app',request_id:randomUUID()});expect(link.error).toBeNull()
    expect((await f.action(session,'snapshot')).status).toBe(403)
    expect((await f.actors[1].client.rpc('authorize_receipt_view',{object_path_input:path})).data).toBe(path)
    expect((await f.actors[1].client.rpc('get_payment_history')).data.some((c:{id:string})=>c.id===charge.id)).toBe(true)
    expect(JSON.stringify((await f.operator.from('payments').select('*').eq('id',p.id).single()).data)).not.toBe(before) // review changed status only
    expect((await f.operator.from('payments').select('amount_sen,receipt_object_path').eq('id',p.id).single()).data).toEqual({amount_sen:2001,receipt_object_path:path})
  })
  it('stores no raw capabilities in application tables or function/container logs',async()=>{
    const sid=await f.session(),i=await f.invite(sid),session=await f.exchange(i.token);await f.action(session,'join')
    const tables=localSql("select jsonb_build_object('audit',(select jsonb_agg(to_jsonb(a)) from public.audit_logs a),'requests',(select jsonb_agg(to_jsonb(r)) from app_private.operation_requests r),'tokens',(select jsonb_agg(to_jsonb(t)) from app_private.guest_access_tokens t),'sessions',(select jsonb_agg(to_jsonb(s)) from app_private.guest_sessions s))")
    expect(tables.includes(i.token)).toBe(false);expect(tables.includes(session)).toBe(false)
    expect(runtimeLogsContain([i.token,session])).toBe(false)
  })
  it('serializes held offers across sessions, counts consented acceptance and releases decline/expiry',async()=>{
    const base=await f.session(),i=await f.invite(base),token=await f.exchange(i.token);expect((await f.action(token,'join')).status).toBe(200)
    const sessions=await Promise.all([f.session(1),f.session(1)]),guests:{token:string;pid:string;sid:string}[]=[]
    for(const sid of sessions){
      const vote=await f.actors[1].client.rpc('cast_session_vote',{session_id_input:sid,choice_input:'play',request_id:randomUUID()});expect(vote.error).toBeNull()
      expect((await f.actors[0].client.rpc('set_waitlist_mode',{session_id_input:sid,mode_input:'manual',reason_input:'Synthetic manual offer concurrency',request_id:randomUUID()})).error).toBeNull()
      const invitation=await f.invite(sid,i.guest_id),guestToken=await f.exchange(invitation.token),joined=await f.action(guestToken,'join');expect(joined.status).toBe(200);const pid=(await joined.json()).participant_id
      expect((await f.actors[1].client.rpc('withdraw_participation',{participant_id_input:vote.data.participant_id,request_id:randomUUID()})).error).toBeNull();guests.push({token:guestToken,pid,sid})
    }
    const release=await holdSession(sessions[0]),release2=await holdSession(sessions[1])
    const offer=(pid:string)=>f.actors[0].client.rpc('admin_offer_slot',{participant_id_input:pid,reason_input:'Synthetic verified guest offer',request_id:randomUUID()})
    // Separate actors prevent the actor/request ledger from serializing the calls.
    const otherAdmin=f.actors[2];localSql(`update public.memberships set role='admin' where user_id=${q(otherAdmin.uid)}`)
    const calls=[Promise.resolve(offer(guests[0].pid)),Promise.resolve(otherAdmin.client.rpc('admin_offer_slot',{participant_id_input:guests[1].pid,reason_input:'Synthetic second guest offer',request_id:randomUUID()}))]
    try{const until=Date.now()+7000;let n=0;while(Date.now()<until){n=Number(localSql("select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%admin_offer_slot%';"));if(n>=2)break;await new Promise(r=>setTimeout(r,50))}expect(n).toBeGreaterThanOrEqual(2)}finally{await release();await release2()}
    const results=await Promise.all(calls);expect(results.filter(r=>!r.error)).toHaveLength(1)
    const accepted=results[0].error?1:0,waiting=1-accepted
    expect((await f.action(guests[accepted].token,'respond',{accept:false})).status).toBe(200)
    expect((await offer(guests[waiting].pid)).error).toBeNull()
    localSql(`update public.waitlist_offers set offered_at=statement_timestamp()-interval '16 minutes',expires_at=statement_timestamp()-interval '1 minute' where participant_id=${q(guests[waiting].pid)} and state='pending'`)
    const expired=await f.action(guests[waiting].token,'respond',{accept:true});expect(expired.status).toBe(200);expect((await expired.json()).offer_state).toBe('expired')
    const snapshot=await (await f.action(token,'snapshot')).json();expect(snapshot.guest.uses_reserved_or_counted).toBe(1)
  })
  it('offers an already-counted late-cancelled rejoin without adding a third guest use',async()=>{
    const sid=await f.session(1),secondSid=await f.session(),i=await f.invite(sid),token=await f.exchange(i.token)
    const joined=await f.action(token,'join');expect(joined.status).toBe(200);const pid=(await joined.json()).participant_id
    const second=await f.invite(secondSid,i.guest_id),secondToken=await f.exchange(second.token);expect((await f.action(secondToken,'join')).status).toBe(200)
    // Seed the retained liability outcome; the existing KL engine is tested
    // independently. This test exercises eligibility, quota and real offer APIs.
    localSql(`update public.participants set participation_status='late_cancelled',attendance='not_applicable',charge_percent=75,liability_percent=75,withdrawn_at=clock_timestamp() where id=${q(pid)}`)
    const occupied=await f.actors[1].client.rpc('cast_session_vote',{session_id_input:sid,choice_input:'play',request_id:randomUUID()});expect(occupied.error).toBeNull()
    expect((await f.action(token,'join')).status).toBe(200)
    expect((await f.actors[1].client.rpc('withdraw_participation',{participant_id_input:occupied.data.participant_id,request_id:randomUUID()})).error).toBeNull()
    const snapshot=await (await f.action(token,'snapshot')).json();expect(snapshot.offer.state).toBe('pending')
    expect((await f.action(token,'respond',{accept:true})).status).toBe(200)
    const current=await (await f.action(token,'snapshot')).json();expect(current.guest.uses_reserved_or_counted).toBe(2);expect(current.participation.liability_percent).toBe(75)
  })
})

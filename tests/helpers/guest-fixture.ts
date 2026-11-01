import { createHash,randomUUID } from 'node:crypto'
import { billingFixture } from './billing-fixture'
import { localSql,sqlLiteral as q } from './local-sql'

export async function guestFixture() {
  const previousBudgets=new Set(JSON.parse(localSql("select coalesce(jsonb_agg(bucket),'[]') from app_private.capability_budgets")) as string[])
  const f=await billingFixture()
  const usedSessions=new Set<string>()
  let phoneCounter=0
  async function endpoint(kind:'guest-access'|'account-recovery',body:object,actor?:number,session?:string) {
    if(session)usedSessions.add(createHash('sha256').update(session).digest('hex'))
    const auth=actor===undefined?null:(await f.actors[actor].client.auth.getSession()).data.session
    return fetch(`${process.env.SUPABASE_TEST_URL}/functions/v1/${kind}`,{method:'POST',headers:{apikey:process.env.SUPABASE_TEST_PUBLISHABLE_KEY!,'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${auth.access_token}`} :{}),...(session?{'X-BJBC-Guest':session}:{})},body:JSON.stringify(body)})
  }
  async function session(capacity=4) {
    const now=Date.now(),r=await f.actors[0].client.rpc('save_session',{session_id_input:null,title_input:'Synthetic Task 7 game',venue_input:'Test court',starts_at_input:new Date(now+172800000).toISOString(),ends_at_input:new Date(now+180000000).toISOString(),voting_closes_at_input:new Date(now+86400000).toISOString(),capacity_input:capacity,waitlist_mode_input:'automatic',request_id:randomUUID()})
    if(r.error)throw new Error('Guest fixture session failed')
    const sid=r.data.session_id
    if((await f.actors[0].client.rpc('publish_session',{session_id_input:sid,request_id:randomUUID()})).error)throw new Error('Guest fixture publish failed')
    f.sessions.push(sid);return sid as string
  }
  async function invite(sid:string,gid?:string,actor=gid?0:1) {
    const phone=`+60113${String((Date.now()+ ++phoneCounter)%10000000).padStart(7,'0')}`
    const r=await endpoint('guest-access',{action:'invite',sessionId:sid,guestId:gid??null,name:'Synthetic Guest',phone,verified:!!gid,reason:gid?'Verified in person for synthetic test':'Synthetic sponsor',requestId:randomUUID()},actor)
    if(r.status!==200)throw new Error(`Guest fixture invitation failed (${r.status})`)
    return await r.json() as {guest_id:string;token_id:string;token:string;expires_at:string}
  }
  async function exchange(token:string) {
    const r=await endpoint('guest-access',{action:'exchange',token});if(r.status!==200)throw new Error(`Guest fixture exchange failed (${r.status})`)
    return (await r.json()).session as string
  }
  const action=(session:string,action:string,extra:object={})=>endpoint('guest-access',{action,requestId:randomUUID(),...extra},undefined,session)
  async function ready(sid:string,sessionToken:string) {
    const joined=await action(sessionToken,'join');if(joined.status!==200)throw new Error('Guest fixture join failed')
    const pid=(await joined.json()).participant_id
    localSql(`update public.sessions set starts_at=clock_timestamp()-interval '3 hours',ends_at=clock_timestamp()-interval '1 hour',voting_closes_at=clock_timestamp()-interval '4 hours' where id=${q(sid)};`)
    const admin=f.actors[0].client
    if((await admin.rpc('set_attendance',{participant_id_input:pid,attendance_input:'present',reason_input:'',request_id:randomUUID()})).error)throw new Error('Guest fixture attendance failed')
    if((await admin.rpc('save_fee_draft',{session_id_input:sid,full_fee_sen_input:2001,court_cost_sen_input:0,shuttle_quantity_input:0,shuttle_cost_sen_input:0,notes_input:'Synthetic guest fee',request_id:randomUUID()})).error)throw new Error('Guest fixture fee failed')
    const preview=await admin.rpc('get_fee_preview',{session_id_input:sid})
    if((await admin.rpc('publish_session_fee',{session_id_input:sid,full_fee_sen_input:2001,review_token_input:preview.data.review_token,reason_input:'',request_id:randomUUID()})).error)throw new Error('Guest fixture fee publication failed')
    return (await f.operator.from('charges').select('*').eq('participant_id',pid).single()).data!
  }
  async function cleanup() {
    const users=f.actors.map(a=>q(a.uid)).join(','),guests=`select id from public.guests where sponsor_user_id in (${users}) or verified_by in (${users})`
    const paths=JSON.parse(localSql(`select coalesce(jsonb_agg(name),'[]') from storage.objects where bucket_id='receipts' and split_part(name,'/',1) in(select id::text from public.guests where id in (${guests}))`)) as string[]
    if(paths.length&&(await f.operator.storage.from('receipts').remove(paths)).error)throw new Error('Guest receipt cleanup failed')
    localSql(`begin;
      -- Scheduler mutations also create actorless audit rows. Wait for any
      -- in-flight worker, then exclude it until all guest rows are removed.
      select id from public.sessions where created_by in (${users}) order by id for update;
      delete from app_private.receipt_checks where guest_id in (${guests});
      delete from app_private.guest_operations where guest_id in (${guests});
      delete from app_private.capability_budgets where bucket in(select 'guest:'||gs.session_hash from app_private.guest_sessions gs join app_private.guest_access_tokens t on t.id=gs.invitation_id where t.guest_id in (${guests}));
      delete from app_private.guest_sessions where invitation_id in(select id from app_private.guest_access_tokens where guest_id in (${guests}));
      delete from app_private.guest_access_tokens where guest_id in (${guests});
      delete from app_private.recovery_tokens where issued_by in (${users}) or user_id in (${users});
      delete from app_private.capability_budgets where bucket in(${f.actors.map(a=>q(`issuer:${a.uid}`)).concat([...usedSessions].map(s=>q(`guest:${s}`)),['guest:global','recovery:global'].filter(b=>!previousBudgets.has(b)).map(q)).join(',')});
      delete from public.audit_logs where actor_guest_id in (${guests});
      delete from public.audit_logs where entity_id in(select p.id from public.participants p join public.players pl on pl.id=p.player_id where pl.guest_id in (${guests}))
        or entity_id in(select o.id from public.waitlist_offers o join public.participants p on p.id=o.participant_id join public.players pl on pl.id=p.player_id where pl.guest_id in (${guests}));
      delete from public.notifications where guest_id in (${guests});
      update public.participants set merged_into_id=null where session_id in(select id from public.sessions where created_by in (${users}));
      delete from public.payments where charge_id in(select c.id from public.charges c join public.participants p on p.id=c.participant_id join public.players pl on pl.id=p.player_id where pl.guest_id in (${guests}));
      delete from public.charges where participant_id in(select p.id from public.participants p join public.players pl on pl.id=p.player_id where pl.guest_id in (${guests}));
      delete from public.waitlist_offers where participant_id in(select p.id from public.participants p join public.players pl on pl.id=p.player_id where pl.guest_id in (${guests}));
      delete from public.participants where player_id in(select id from public.players where guest_id in (${guests}));
      delete from public.players where guest_id in (${guests});delete from public.guests where id in (${guests});commit;`)
    await f.cleanup()
  }
  return {...f,endpoint,session,invite,exchange,action,ready,cleanup}
}

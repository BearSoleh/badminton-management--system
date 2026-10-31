import { randomBytes,randomUUID } from 'node:crypto'
import { createClient,type SupabaseClient } from '@supabase/supabase-js'
import { localSql,sqlLiteral as q } from './local-sql'

const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}
export async function billingFixture() {
  const url=process.env.SUPABASE_TEST_URL!,key=process.env.SUPABASE_TEST_PUBLISHABLE_KEY!
  const operator=createClient(url,process.env.SUPABASE_TEST_SECRET_KEY!,options)
  const actors:{uid:string;phone:string;password:string;client:SupabaseClient}[]=[]
  const sessions:string[]=[]
  async function cleanup() {
    const ids=actors.map(a=>q(a.uid)).join(',');if(!ids)return
    // All targets derive exclusively from Auth identities created by this helper.
    localSql(`begin;
      delete from public.audit_logs where actor_user_id in (${ids}) or entity_id in(select id from public.participants where session_id in(select id from public.sessions where created_by in (${ids})));
      delete from app_private.operation_requests where actor_user_id in (${ids});
      delete from app_private.notification_outbox where event_key in(select event_key from public.notifications where user_id in (${ids}));
      delete from public.notifications where user_id in (${ids});
      delete from public.payments where charge_id in(select id from public.charges where session_id in(select id from public.sessions where created_by in (${ids})));
      delete from public.charges where session_id in(select id from public.sessions where created_by in (${ids}));
      delete from app_private.fee_cost_snapshots where fee_version_id in(select id from public.fee_versions where session_id in(select id from public.sessions where created_by in (${ids})));
      delete from public.fee_versions where session_id in(select id from public.sessions where created_by in (${ids}));
      delete from public.session_costs where session_id in(select id from public.sessions where created_by in (${ids}));
      delete from public.waitlist_offers where participant_id in(select id from public.participants where session_id in(select id from public.sessions where created_by in (${ids})));
      delete from public.votes where user_id in (${ids});
      delete from public.participants where session_id in(select id from public.sessions where created_by in (${ids}));
      delete from public.polls where session_id in(select id from public.sessions where created_by in (${ids}));
      delete from public.sessions where created_by in (${ids});
      delete from public.players where user_id in (${ids});commit;`)
    for(const a of actors)if((await operator.auth.admin.deleteUser(a.uid)).error)throw new Error('Synthetic billing identity cleanup failed')
  }
  try {
    for(let i=0;i<5;i++) {
      const phone=`+60112${String(Date.now()+i).slice(-7)}`,password=randomBytes(24).toString('base64url')
      const created=await operator.auth.admin.createUser({phone,password,phone_confirm:true,user_metadata:{display_name:i===0?'Synthetic Billing Admin':`Synthetic Billing Player ${i}`}})
      if(created.error||!created.data.user)throw new Error('Synthetic billing identity creation failed')
      const uid=created.data.user.id,client=createClient(url,key,options);actors.push({uid,phone,password,client})
      if((await operator.from('memberships').update({status:i===4?'pending':'active',role:i===0?'admin':'member'}).eq('user_id',uid)).error)throw new Error('Synthetic membership setup failed')
      if((await client.auth.signInWithPassword({phone,password})).error)throw new Error('Synthetic login failed')
    }
  }catch(e){await cleanup();throw e}
  async function session() {
    const now=Date.now()
    const draft=await actors[0].client.rpc('save_session',{session_id_input:null,title_input:'Synthetic Task 5 game',venue_input:'Test court',starts_at_input:new Date(now+172800000).toISOString(),ends_at_input:new Date(now+180000000).toISOString(),voting_closes_at_input:new Date(now+86400000).toISOString(),capacity_input:3,waitlist_mode_input:'manual',request_id:randomUUID()})
    if(draft.error)throw new Error('Synthetic billing session creation failed')
    const sid=draft.data.session_id;sessions.push(sid)
    if((await actors[0].client.rpc('publish_session',{session_id_input:sid,request_id:randomUUID()})).error)throw new Error('Synthetic session publication failed')
    const pids:string[]=[]
    for(let i=1;i<4;i++) {
      const p=await actors[i].client.rpc('cast_session_vote',{session_id_input:sid,choice_input:'play',request_id:randomUUID()})
      if(p.error)throw new Error('Synthetic billing participation failed')
      pids.push(p.data.participant_id)
    }
    localSql(`update public.sessions set starts_at=clock_timestamp()-interval '3 hours',ends_at=clock_timestamp()-interval '1 hour',voting_closes_at=clock_timestamp()-interval '4 hours' where id=${q(sid)};
      update public.participants set participation_status='late_cancelled',attendance='not_applicable',charge_percent=75,liability_percent=75,withdrawn_at=clock_timestamp()-interval '4 hours' where id=${q(pids[2])};`)
    return {sid,pids}
  }
  return {operator,actors,sessions,session,cleanup}
}

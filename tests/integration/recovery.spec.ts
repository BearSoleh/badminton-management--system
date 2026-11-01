import { randomBytes,randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { afterAll,beforeAll,describe,expect,it } from 'vitest'
import { guestFixture } from '../helpers/guest-fixture'
import { localSql,sqlLiteral as q } from '../helpers/local-sql'
import { runtimeLogsContain } from '../helpers/runtime-logs'
let f:Awaited<ReturnType<typeof guestFixture>>
describe('real Task 7 audited recovery and provider session revocation',()=>{
  beforeAll(async()=>{f=await guestFixture()});afterAll(async()=>{await f?.cleanup()})
  const issue=(actor=0,verified=true,target=f.actors[1].uid)=>f.endpoint('account-recovery',{action:'issue',userId:target,verified,reason:'Synthetic independent identity verification',requestId:randomUUID()},actor)
  it('denies anonymous/member/pending/suspended issuance and unverified admin issuance with generic errors',async()=>{
    for(const actor of [undefined,1,4])expect((await f.endpoint('account-recovery',{action:'issue',userId:f.actors[1].uid,verified:true,reason:'Synthetic check',requestId:randomUUID()},actor)).status).toBe(403)
    expect((await issue(0,false)).status).toBe(403)
    localSql(`update public.memberships set status='suspended' where user_id=${q(f.actors[0].uid)}`)
    try{expect((await issue()).status).toBe(403)}finally{localSql(`update public.memberships set status='active' where user_id=${q(f.actors[0].uid)}`)}
  })
  it('rejects expired, superseded, invalid and suspended-issuer capabilities',async()=>{
    const old=await (await issue()).json(),next=await (await issue()).json(),password=randomBytes(24).toString('base64url')
    const reset=(token:string)=>f.endpoint('account-recovery',{action:'reset',token,password})
    for(const token of [old.token,randomBytes(32).toString('base64url')])expect((await reset(token)).status).toBe(403)
    localSql(`update app_private.recovery_tokens set created_at=clock_timestamp()-interval '1 hour',expires_at=clock_timestamp()-interval '1 second' where id=${q(next.recovery_id)}`)
    expect((await reset(next.token)).status).toBe(403)
    const issued=await (await issue()).json();localSql(`update public.memberships set status='suspended' where user_id=${q(f.actors[0].uid)}`)
    try{expect((await reset(issued.token)).status).toBe(403)}finally{localSql(`update public.memberships set status='active' where user_id=${q(f.actors[0].uid)}`)}
  })
  it('changes the password once, revokes real refresh sessions and leaves signed access JWT lifetime explicit',async()=>{
    const actor=f.actors[2],options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}},client=createClient(process.env.SUPABASE_TEST_URL!,process.env.SUPABASE_TEST_PUBLISHABLE_KEY!,options)
    const oldLogin=await client.auth.signInWithPassword({phone:actor.phone,password:actor.password});expect(oldLogin.error).toBeNull()
    const oldSession=oldLogin.data.session!,issued=await (await issue(0,true,actor.uid)).json(),password=randomBytes(24).toString('base64url')
    const responses=await Promise.all([f.endpoint('account-recovery',{action:'reset',token:issued.token,password}),f.endpoint('account-recovery',{action:'reset',token:issued.token,password})]);expect(responses.map(r=>r.status).sort()).toEqual([200,403])
    expect((await client.auth.refreshSession({refresh_token:oldSession.refresh_token})).error).not.toBeNull()
    expect((await client.auth.signInWithPassword({phone:actor.phone,password:actor.password})).error).not.toBeNull()
    expect((await client.auth.signInWithPassword({phone:actor.phone,password})).error).toBeNull()
    actor.password=password
    const stale=await fetch(`${process.env.SUPABASE_TEST_URL}/rest/v1/rpc/get_my_membership`,{method:'POST',headers:{apikey:process.env.SUPABASE_TEST_PUBLISHABLE_KEY!,Authorization:`Bearer ${oldSession.access_token}`,'Content-Type':'application/json'},body:'{}'})
    expect(stale.status).toBe(200) // Provider cannot retract already signed JWTs.
    const records=localSql(`select jsonb_build_object('recovery',(select jsonb_agg(to_jsonb(t)) from app_private.recovery_tokens t where user_id=${q(actor.uid)}),'audit',(select jsonb_agg(to_jsonb(a)) from public.audit_logs a where entity_id=${q(actor.uid)}))`)
    expect(records).not.toContain(password);expect(records).not.toContain(issued.token);expect(records).toContain('recovery_completed')
    expect(runtimeLogsContain([password,issued.token])).toBe(false)
  })
  it('resets a suspended target without restoring participation privileges',async()=>{
    const target=f.actors[3];localSql(`update public.memberships set status='suspended' where user_id=${q(target.uid)}`)
    const issued=await (await issue(0,true,target.uid)).json(),password=randomBytes(24).toString('base64url')
    expect((await f.endpoint('account-recovery',{action:'reset',token:issued.token,password})).status).toBe(200);target.password=password
    expect((await target.client.auth.signInWithPassword({phone:target.phone,password})).error).toBeNull()
    expect((await target.client.rpc('get_my_membership')).data[0].status).toBe('suspended')
    expect((await target.client.rpc('join_session',{session_id_input:randomUUID(),request_id:randomUUID()})).error?.message).toBe('MEMBERSHIP_NOT_ACTIVE')
  })
})

import { randomBytes,randomUUID } from 'node:crypto'
import { createClient,type SupabaseClient } from '@supabase/supabase-js'
import { expect,test } from '@playwright/test'
import { localSql,sqlLiteral as q } from '../helpers/local-sql'

test('real manual admin offer, member inbox/Continue and automatic next-player Decline',async({page},testInfo)=>{
  const url=process.env.SUPABASE_TEST_URL!,key=process.env.SUPABASE_TEST_PUBLISHABLE_KEY!
  const options={auth:{persistSession:false,autoRefreshToken:false}}
  const operator=createClient(url,process.env.SUPABASE_TEST_SECRET_KEY!,options)
  const actors:{uid:string;phone:string;password:string;client:SupabaseClient}[]=[]
  let sid:string|undefined
  const signIn=async(i:number)=>{
    await page.goto('/login');await page.getByLabel('Phone number').fill(actors[i].phone)
    await page.getByLabel('Password',{exact:true}).fill(actors[i].password)
    await page.getByRole('button',{name:'Log in',exact:true}).click()
    await expect(page.getByRole('heading',{name:`Welcome back, Synthetic queue ${i}.`,exact:true})).toBeVisible()
  }
  try {
    for(let i=0;i<4;i++) {
      const phone=`+60112${String(Date.now()+i).slice(-7)}`,password=randomBytes(24).toString('base64url')
      const r=await operator.auth.admin.createUser({phone,password,phone_confirm:true,user_metadata:{display_name:`Synthetic queue ${i}`}})
      expect(r.error).toBeNull();const uid=r.data.user!.id,client=createClient(url,key,options)
      actors.push({uid,phone,password,client})
      expect((await operator.from('memberships').update({role:i?'member':'admin',status:'active'}).eq('user_id',uid)).error).toBeNull()
      expect((await client.auth.signInWithPassword({phone,password})).error).toBeNull()
    }
    const now=Date.now()
    const created=await actors[0].client.rpc('save_session',{session_id_input:null,title_input:'Synthetic Task 4 UI game',venue_input:'Synthetic Court A',starts_at_input:new Date(now+172800000).toISOString(),ends_at_input:new Date(now+180000000).toISOString(),voting_closes_at_input:new Date(now+86400000).toISOString(),capacity_input:1,waitlist_mode_input:'manual',request_id:randomUUID()})
    expect(created.error).toBeNull();sid=created.data.session_id
    expect((await actors[0].client.rpc('publish_session',{session_id_input:sid,request_id:randomUUID()})).error).toBeNull()
    const players=[]
    for(let i=1;i<4;i++) {
      const r=await actors[i].client.rpc('cast_session_vote',{session_id_input:sid,choice_input:'play',request_id:randomUUID()})
      expect(r.error).toBeNull();players.push(r.data)
    }
    expect((await actors[1].client.rpc('withdraw_participation',{participant_id_input:players[0].participant_id,request_id:randomUUID()})).error).toBeNull()
    await signIn(0);await page.goto(`/admin/sessions/${sid}`)
    const controls=page.getByRole('region',{name:'Waiting-list controls'})
    await controls.getByRole('radio',{name:/Synthetic queue 2/}).check()
    await controls.getByLabel('Reason for admin action').fill('Player available; offering the first waiting place')
    await controls.getByRole('button',{name:'Offer selected player',exact:true}).click()
    await expect(controls).toContainText('Awaiting confirmation')
    await controls.getByLabel('Promotion mode').selectOption('automatic')
    await controls.getByLabel('Reason for admin action').fill('Use automatic priority for the remaining queue')
    await controls.getByRole('button',{name:'Save promotion mode',exact:true}).click()
    await expect(controls.getByLabel('Promotion mode')).toHaveValue('automatic')
    await expect(controls.getByRole('button',{name:'Offer selected player',exact:true})).toBeVisible()
    await page.screenshot({path:`.superpowers/task4-admin-${testInfo.project.name}.png`,fullPage:true})
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await page.getByRole('button',{name:'Log out',exact:true}).click()

    await signIn(2)
    await expect(page.getByRole('region',{name:'Active slot offers'})).toContainText('Synthetic Task 4 UI game')
    await page.getByRole('link',{name:'Notifications',exact:true}).click()
    await expect(page.getByText('Unread',{exact:true})).toBeVisible()
    await page.getByRole('button',{name:'Mark as read',exact:true}).click()
    await expect(page.getByText('Unread',{exact:true})).toHaveCount(0)
    await page.screenshot({path:`.superpowers/task4-inbox-${testInfo.project.name}.png`,fullPage:true})
    await page.getByRole('link',{name:'View session',exact:true}).click()
    await expect(page.getByRole('heading',{name:'A place is available',exact:true})).toBeVisible()
    await expect(page.getByLabel('Time remaining')).toContainText('14:')
    await page.reload()
    await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeVisible()
    await page.getByRole('button',{name:'Continue',exact:true}).focus()
    await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeFocused()
    await page.screenshot({path:`.superpowers/task4-offer-${testInfo.project.name}.png`,fullPage:true})
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await page.getByRole('button',{name:'Continue',exact:true}).click()
    await expect(page.getByRole('region',{name:'Your participation'})).toContainText('Confirmed')
    await page.getByRole('button',{name:'Withdraw',exact:true}).click()
    await page.getByRole('button',{name:'Confirm withdrawal',exact:true}).click()
    await expect(page.getByRole('region',{name:'Your participation'})).toContainText('Withdrawn early')
    await page.getByRole('button',{name:'Log out',exact:true}).click()

    await signIn(3);await page.goto(`/app/sessions/${sid}`)
    await page.getByRole('button',{name:'Decline',exact:true}).click()
    await expect(page.getByRole('region',{name:'Your participation'})).toContainText('Offer declined')
    const record=await operator.from('participants').select('charge_percent,liability_percent').eq('id',players[2].participant_id).single()
    expect(record.data).toEqual({charge_percent:0,liability_percent:0})
    await page.getByRole('button',{name:'Log out',exact:true}).click()
  } finally {
    if(actors.length) {
      const uids=actors.map(a=>q(a.uid)).join(',')
      localSql(`begin;
        delete from public.audit_logs where actor_user_id in (${uids}) or entity_id in(select p.id from public.participants p join public.sessions s on s.id=p.session_id where s.created_by in (${uids})) or entity_id in(select id from public.waitlist_offers where participant_id in(select p.id from public.participants p join public.sessions s on s.id=p.session_id where s.created_by in (${uids})));
        delete from app_private.operation_requests where actor_user_id in (${uids});
        delete from app_private.notification_outbox where event_key in(select event_key from public.notifications where user_id in (${uids}));
        delete from public.notifications where user_id in (${uids});
        delete from public.waitlist_offers where participant_id in(select p.id from public.participants p join public.sessions s on s.id=p.session_id where s.created_by in (${uids}));
        delete from public.votes where user_id in (${uids});
        delete from public.participants where session_id in(select id from public.sessions where created_by in (${uids}));
        delete from public.polls where session_id in(select id from public.sessions where created_by in (${uids}));
        delete from public.sessions where created_by in (${uids});
        delete from public.players where user_id in (${uids});commit;`)
      for(const a of actors)expect((await operator.auth.admin.deleteUser(a.uid)).error).toBeNull()
    }
  }
})

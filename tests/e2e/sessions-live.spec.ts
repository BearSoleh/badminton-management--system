import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import { localSql, sqlLiteral as q } from '../helpers/local-sql'

test('real admin draft/edit/publish and member vote/withdraw/post-vote join', async ({ page }, testInfo) => {
  const operator=createClient(process.env.SUPABASE_TEST_URL!,process.env.SUPABASE_TEST_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false}})
  const fixtures: {uid:string;phone:string;password:string}[]=[]
  let sid: string|undefined
  try {
    for(let i=0;i<2;i++) {
      const phone=`+60112${String(Date.now()+i).slice(-7)}`,password=randomBytes(24).toString('base64url')
      const r=await operator.auth.admin.createUser({phone,password,phone_confirm:true,user_metadata:{display_name:i?'Synthetic Player':'Synthetic Admin'}})
      expect(r.error).toBeNull(); const uid=r.data.user!.id
      fixtures.push({uid,phone,password})
      expect((await operator.from('memberships').update({role:i?'member':'admin',status:'active'}).eq('user_id',uid)).error).toBeNull()
    }
    await page.goto('/login')
    await page.getByLabel('Phone number').fill(fixtures[0].phone)
    await page.getByLabel('Password',{exact:true}).fill(fixtures[0].password)
    await page.getByRole('button',{name:'Log in',exact:true}).click()
    await page.getByRole('link',{name:'Manage sessions',exact:true}).click()
    await page.getByRole('link',{name:'New session',exact:true}).click()
    await page.getByLabel('Session title').fill('Synthetic live game')
    await page.getByLabel('Venue').fill('Test Court A')
    const kl=(ms:number)=>new Date(ms+8*3600000).toISOString().slice(0,16)
    await page.getByLabel('Starts at (KL)').fill(kl(Date.now()+172800000))
    await page.getByLabel('Ends at (KL)').fill(kl(Date.now()+180000000))
    await page.getByLabel('Voting closes at (KL)').fill(kl(Date.now()+86400000))
    await page.getByLabel('Player capacity').fill('2')
    await page.getByRole('button',{name:'Save draft',exact:true}).click()
    await expect(page.getByRole('heading',{name:'Synthetic live game',exact:true})).toBeVisible()
    const record=await operator.from('sessions').select('id').eq('created_by',fixtures[0].uid).single()
    sid=record.data!.id
    await page.getByRole('link',{name:'Edit draft',exact:true}).click()
    await page.getByLabel('Venue').fill('Test Court B')
    await page.getByRole('button',{name:'Save draft',exact:true}).click()
    await expect(page.getByText('Test Court B',{exact:true})).toBeVisible()
    await page.getByRole('button',{name:'Publish voting',exact:true}).click()
    await expect(page.getByText('Voting open',{exact:true}).first()).toBeVisible()
    await page.getByRole('button',{name:'Log out',exact:true}).click()
    await page.getByLabel('Phone number').fill(fixtures[1].phone)
    await page.getByLabel('Password',{exact:true}).fill(fixtures[1].password)
    await page.getByRole('button',{name:'Log in',exact:true}).click()
    await expect(page.getByRole('link',{name:'Manage sessions',exact:true})).toHaveCount(0)
    await page.getByRole('link',{name:'Synthetic live game',exact:true}).click()
    await page.getByRole('button',{name:'Not playing',exact:true}).click()
    await expect(page.getByRole('region',{name:'Your participation'})).toContainText('Not playing')
    await page.getByRole('button',{name:'Play',exact:true}).click()
    await expect(page.getByRole('region',{name:'Your participation'})).toContainText('Confirmed')
    await expect(page.getByText('Fee not yet set',{exact:true}).first()).toBeVisible()
    await page.getByRole('button',{name:'Withdraw',exact:true}).click()
    const confirmation=page.getByRole('group',{name:'Confirm withdrawal'})
    await expect(confirmation).toContainText('0%')
    await expect(confirmation).toContainText('determined after the session')
    await page.getByRole('button',{name:'Confirm withdrawal',exact:true}).click()
    await expect(page.getByRole('region',{name:'Your participation'})).toContainText('Withdrawn early')
    localSql(`update public.sessions set voting_closes_at=clock_timestamp()-interval '1 second' where id=${q(sid!)}`)
    await page.getByRole('button',{name:'Refresh session',exact:true}).click()
    await page.getByRole('button',{name:'Rejoin session',exact:true}).click()
    await expect(page.getByRole('region',{name:'Your participation'})).toContainText('Confirmed')
    await page.reload()
    await expect(page.getByRole('region',{name:'Your participation'})).toContainText('Confirmed')
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await page.screenshot({path:`.superpowers/task3-detail-${testInfo.project.name}.png`,fullPage:true})
    await page.getByRole('link',{name:'Sessions',exact:true}).click()
    await expect(page.getByRole('link',{name:'Synthetic live game',exact:true})).toBeVisible()
    await page.screenshot({path:`.superpowers/task3-home-${testInfo.project.name}.png`,fullPage:true})
    await page.getByRole('button',{name:'Log out',exact:true}).click()
  } finally {
    const ids=fixtures.map(f=>q(f.uid)).join(',')
    if(ids) {
      // Find a just-created draft even if a UI assertion failed before sid lookup.
      localSql(`begin;
        delete from public.audit_logs where actor_user_id in (${ids});
        delete from app_private.operation_requests where actor_user_id in (${ids});
        delete from public.votes where user_id in (${ids});
        delete from public.participants where session_id in(select id from public.sessions where created_by in (${ids}));
        delete from public.polls where session_id in(select id from public.sessions where created_by in (${ids}));
        delete from public.sessions where created_by in (${ids});
        delete from public.players where user_id in (${ids}); commit;`)
      for(const f of fixtures) expect((await operator.auth.admin.deleteUser(f.uid)).error).toBeNull()
    }
  }
})

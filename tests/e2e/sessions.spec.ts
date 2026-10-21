import { expect,test } from '@playwright/test'
import { authFixture,login } from '../helpers/browser-auth'

// Deliberate HTTP fixtures for UI failures/confirmation behavior; live tests
// separately prove actual database changes and concurrency.
const sid='30000000-0000-4000-8000-000000000001',pid='30000000-0000-4000-8000-000000000002'
const upcoming={id:sid,title:'Fixture Friday game',venue:'Fixture Court',starts_at:'2099-10-23T12:00:00Z',ends_at:'2099-10-23T14:00:00Z',voting_closes_at:'2099-10-22T12:00:00Z',capacity:2,operational_status:'voting_open',billing_status:'not_published',waitlist_mode:'automatic',created_by:sid,created_at:'2026-10-22T00:00:00Z',updated_at:'2026-10-22T00:00:00Z'}
test('late withdrawal explains 75%, requires confirmation, and reuses request ID after a failed attempt',async({page})=>{
  await authFixture(page,'active')
  let withdrawn=false
  const requests:string[]=[]
  await page.route('**/rest/v1/rpc/get_session_snapshot',route=>route.fulfill({json:{session:upcoming,server_now:'2099-10-23T01:00:00Z',participation:{id:pid,participation_status:withdrawn?'late_cancelled':'confirmed',liability_percent:withdrawn?75:0},vote:'play',roster:[{participant_id:pid,session_id:sid,display_name:'Bear',participation_status:withdrawn?'late_cancelled':'confirmed',attendance:'unmarked'}],counts:{confirmed:withdrawn?0:1,held:0,waiting:0},can_vote:false,can_join:true,can_withdraw:!withdrawn,withdrawal_percent:75}}))
  await page.route('**/rest/v1/rpc/withdraw_participation',async route=>{
    const payload=route.request().postDataJSON()
    expect(Object.keys(payload).sort()).toEqual(['participant_id_input','request_id'])
    expect(payload.participant_id_input).toBe(pid)
    requests.push(payload.request_id)
    if(requests.length===1)return route.fulfill({status:503,json:{message:'synthetic private server diagnostic'}})
    withdrawn=true;return route.fulfill({json:{participant_id:pid,participation_status:'late_cancelled',charge_percent:75}})
  })
  await login(page)
  await expect(page.getByRole('heading',{name:'Welcome back, Bear.'})).toBeVisible()
  await page.goto(`/app/sessions/${sid}`)
  await page.getByRole('button',{name:'Withdraw',exact:true}).click()
  const confirm=page.getByRole('group',{name:'Confirm withdrawal'})
  await expect(confirm).toContainText('75%')
  await expect(confirm).toContainText('determined after the session')
  expect(requests).toHaveLength(0)
  await page.getByRole('button',{name:'Confirm withdrawal',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('We couldn’t complete that request.')
  await expect(page.getByText('synthetic private server diagnostic')).toHaveCount(0)
  await page.getByRole('button',{name:'Confirm withdrawal',exact:true}).click()
  await expect(page.getByRole('region',{name:'Your participation'})).toContainText('Late cancelled')
  expect(requests).toHaveLength(2);expect(requests[0]).toBe(requests[1])
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
test('member list separates upcoming/history and rejects admin navigation',async({page})=>{
  await authFixture(page,'active')
  const past={...upcoming,id:pid,title:'Fixture completed game',operational_status:'completed',starts_at:'2026-10-01T12:00:00Z',ends_at:'2026-10-01T14:00:00Z'}
  await page.route('**/rest/v1/sessions?**',route=>route.fulfill({json:[upcoming,past]}))
  await login(page)
  await expect(page.getByRole('link',{name:upcoming.title,exact:true})).toBeVisible()
  await expect(page.getByRole('link',{name:past.title,exact:true})).toHaveCount(0)
  await page.getByRole('button',{name:'History',exact:true}).click()
  await expect(page.getByRole('link',{name:past.title,exact:true})).toBeVisible()
  await expect(page.getByRole('link',{name:upcoming.title,exact:true})).toHaveCount(0)
  await page.goto('/admin/sessions/new')
  await expect(page).toHaveURL(/\/app$/)
  await expect(page.getByRole('heading',{name:'New session',exact:true})).toHaveCount(0)
})
test('a failed session code download gives a recoverable screen',async({page})=>{
  await authFixture(page,'active')
  await page.route('**/src/features/sessions/SessionPages.tsx*',route=>route.abort('failed'))
  await login(page)
  await expect(page.getByRole('heading',{name:'We couldn’t open this page.'})).toBeVisible()
  await page.unroute('**/src/features/sessions/SessionPages.tsx*')
  await page.getByRole('button',{name:'Reload page',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Welcome back, Bear.'})).toBeVisible()
})

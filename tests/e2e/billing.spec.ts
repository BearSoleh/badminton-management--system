import { expect,test } from '@playwright/test'
import { authFixture,login } from '../helpers/browser-auth'

const sid='50000000-0000-4000-8000-000000000001',pid='50000000-0000-4000-8000-000000000002'
test('admin reviews attendance and manual fee, invalidates edited preview and retries publication safely',async({page},info)=>{
  await authFixture(page,'active')
  await page.route('**/rest/v1/rpc/get_my_membership',r=>r.fulfill({json:[{user_id:pid,display_name:'Bear',role:'admin',status:'active'}]}))
  let attendance='unmarked',fee:number|null=null,published=false
  const session={id:sid,title:'Synthetic billing game',venue:'Test court',starts_at:'2026-10-01T12:00:00Z',ends_at:'2026-10-01T14:00:00Z',billing_status:'not_published',operational_status:'joining_open'}
  await page.route('**/rest/v1/rpc/get_fee_preview',r=>r.fulfill({json:{session:{...session,billing_status:published?'published':'not_published'},server_now:'2026-10-02T00:00:00Z',costs:fee===null?null:{full_fee_sen:fee,court_cost_sen:10000,shuttle_quantity:3,shuttle_cost_sen:4500,notes:'Court and shuttles'},latest_version:published?1:0,unmarked_count:attendance==='unmarked'?1:0,review_token:`token:${attendance}:${fee}`,rows:[{participant_id:pid,display_name:'Synthetic Player',participation_status:'confirmed',confirmed_at:'2026-09-30T00:00:00Z',attendance,percent:100,amount_sen:attendance==='unmarked'?null:fee},{participant_id:sid,display_name:'Synthetic Late',participation_status:'late_cancelled',attendance:'not_applicable',percent:75,amount_sen:fee===null?null:1501}]}}))
  await page.route('**/rest/v1/rpc/set_attendance',r=>{attendance=r.request().postDataJSON().attendance_input;return r.fulfill({json:{}})})
  await page.route('**/rest/v1/rpc/save_fee_draft',r=>{const body=r.request().postDataJSON();expect(body.full_fee_sen_input).toBe(2001);expect(body.notes_input).toBe('Court and shuttles');fee=body.full_fee_sen_input;return r.fulfill({json:{}})})
  const requests:string[]=[]
  await page.route('**/rest/v1/rpc/publish_session_fee',r=>{
    const body=r.request().postDataJSON();expect(body.full_fee_sen_input).toBe(2001);expect(body.review_token_input).toBe('token:present:2001');requests.push(body.request_id)
    if(requests.length===1)return r.fulfill({status:503,json:{message:'private diagnostic'}})
    published=true;return r.fulfill({json:{version:1}})
  })
  await login(page);await expect(page.getByRole('heading',{name:'Welcome back, Bear.'})).toBeVisible()
  await page.goto(`/admin/sessions/${sid}/attendance`)
  await expect(page.getByText('Fee not yet set',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Review charges',exact:true})).toBeDisabled()
  await page.getByLabel('Attendance for Synthetic Player').selectOption('present')
  await page.getByLabel('Full per-player fee (RM)').fill('20.01')
  await page.getByLabel('Court cost (RM)').fill('100.00')
  await page.getByLabel('Shuttles used').fill('3')
  await page.getByLabel('Shuttle cost (RM)').fill('45.00')
  await page.getByLabel('Cost notes').fill('Court and shuttles')
  await page.getByRole('button',{name:'Review charges',exact:true}).click()
  const review=page.getByRole('region',{name:'Charge preview'})
  await expect(review).toContainText('RM 20.01');await expect(review).toContainText('RM 15.01')
  await page.getByLabel('Full per-player fee (RM)').fill('21.00')
  await expect(review).toHaveCount(0)
  await page.getByLabel('Full per-player fee (RM)').fill('20.01')
  await page.getByRole('button',{name:'Review charges',exact:true}).click()
  await page.getByLabel('I reviewed every participant’s charge.').check()
  await page.getByRole('button',{name:'Publish fees',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('We couldn’t complete that request.')
  await expect(page.getByText('private diagnostic')).toHaveCount(0)
  await page.getByRole('button',{name:'Publish fees',exact:true}).click()
  await expect(page.getByText('Published fee version 1.',{exact:true})).toBeVisible()
  expect(requests).toHaveLength(2);expect(requests[0]).toBe(requests[1])
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:`.superpowers/task5-admin-${info.project.name}.png`,fullPage:true})
})

test('member fee details use the immutable charge version and display intentional zero',async({page})=>{
  await authFixture(page,'active')
  let zero=false
  await page.route('**/rest/v1/rpc/get_session_snapshot',r=>r.fulfill({json:{session:{id:sid,title:'Synthetic published game',venue:'Test court',starts_at:'2026-10-01T12:00:00Z',ends_at:'2026-10-01T14:00:00Z',voting_closes_at:'2026-09-30T12:00:00Z',updated_at:zero?'2026-10-02T01:00:00Z':'2026-10-02T00:00:00Z',capacity:2,billing_status:'published',operational_status:'completed'},server_now:'2026-10-02T00:00:00Z',participation:{id:pid,participation_status:'confirmed'},roster:[],counts:{confirmed:1,held:0,waiting:0},can_vote:false,can_join:false,can_withdraw:false}}))
  await page.route('**/rest/v1/charges?**',r=>r.fulfill({json:[{fee_version_id:pid,amount_sen:zero?0:2001,percent:100,status:zero?'voided':'unpaid'}]}))
  // A newer publication may commit between HTTP reads. The display must use
  // the version referenced by the fetched immutable charge, not latest again.
  await page.route('**/rest/v1/fee_versions?**',r=>r.fulfill({json:[new URL(r.request().url()).searchParams.get('id')===`eq.${pid}`?{id:pid,full_fee_sen:zero?0:2001,version:1}:{id:sid,full_fee_sen:2500,version:2}]}))
  await login(page);await expect(page.getByRole('heading',{name:'Welcome back, Bear.'})).toBeVisible()
  await page.goto(`/app/sessions/${sid}`)
  const own=page.getByRole('region',{name:'Your participation'})
  await expect(own.locator('.session-fee>strong')).toHaveText('RM 20.01')
  await expect(own).toContainText('Fee version 1.')
  zero=true;await page.getByRole('button',{name:'Refresh session',exact:true}).click()
  await expect(own.locator('.session-fee>strong')).toHaveText('RM 0.00')
  await expect(own).toContainText('No amount due')
  await expect(page.getByText('Fee not yet set',{exact:true})).toHaveCount(0)
})

import { expect,test } from '@playwright/test'
import { authFixture,login } from '../helpers/browser-auth'
const token='a'.repeat(43),session='b'.repeat(43),id='70000000-0000-4000-8000-000000000001'
test('a failed guest page download provides a recovery action',async({page})=>{
  await authFixture(page)
  await page.route('**/src/features/guests/GuestPortal.tsx',r=>r.abort())
  await page.goto('/guest/access')
  await expect(page.getByRole('heading',{name:'We couldn’t open this page.'})).toBeVisible()
  await expect(page.getByRole('button',{name:'Reload page',exact:true})).toBeVisible()
})
test('private invitation clears its fragment, keeps session in memory and explains the third-place limit',async({page})=>{
  await authFixture(page,'active');const bodies:Record<string,unknown>[]=[]
  await page.route('**/functions/v1/guest-access',r=>{
    const b=r.request().postDataJSON();bodies.push(b)
    if(b.action==='exchange')return r.fulfill({json:{session,expires_at:new Date(Date.now()+1800000).toISOString()}})
    expect(r.request().headers()['x-bjbc-guest']).toBe(session)
    if(b.action==='join')return r.fulfill({status:400,json:{error:'GUEST_ACCOUNT_REQUIRED',diagnostic:'hidden server details'}})
    return r.fulfill({json:{guest:{id,name:'Synthetic Guest',uses_reserved_or_counted:2},session:{id,title:'Synthetic guest game',venue:'Test court',starts_at:new Date(Date.now()+172800000).toISOString(),ends_at:new Date(Date.now()+180000000).toISOString(),operational_status:'voting_open',billing_status:'not_published'},participation:null,offer:null,charges:[],withdrawal_percent:0,bank:null,server_now:new Date().toISOString()}})
  })
  await page.goto(`/guest/access#token=${token}`);await expect(page).toHaveURL(/\/guest\/access$/)
  await page.getByRole('button',{name:'Open private invitation',exact:true}).click();await expect(page.getByRole('heading',{name:'Synthetic guest game',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Join this session',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Two guest places')
  expect(await page.evaluate(()=>JSON.stringify(localStorage)+JSON.stringify(sessionStorage))).not.toContain(session)
  await expect(page.getByText('hidden server details')).toHaveCount(0)
  await page.reload();await expect(page.getByRole('heading',{name:'Invitation unavailable',exact:true})).toBeVisible()
  expect(bodies.filter(b=>b.action==='exchange')).toHaveLength(1)
})
test('guest confirms KL withdrawal and reads private payment/refund history',async({page},info)=>{
  await authFixture(page,'active');let withdrawn=false,confirmed=false
  await page.route('**/functions/v1/guest-access',r=>{
    const b=r.request().postDataJSON();if(b.action==='exchange')return r.fulfill({json:{session,expires_at:new Date(Date.now()+1800000).toISOString()}})
    if(b.action==='withdraw'){withdrawn=true;return r.fulfill({json:{participation_status:'late_cancelled'}})}
    if(b.action==='respond'){expect(b.accept).toBe(true);confirmed=true;return r.fulfill({json:{offer_state:'accepted'}})}
    const starts=new Date(Date.now()+3600000).toISOString()
    return r.fulfill({json:{guest:{id,name:'Synthetic Guest',uses_reserved_or_counted:1},session:{id,title:'Synthetic held game',venue:'Test court',starts_at:starts,ends_at:new Date(Date.now()+7200000).toISOString(),operational_status:'joining_open',billing_status:'published'},participation:{id,participation_status:withdrawn?'late_cancelled':confirmed?'confirmed':'offered'},offer:confirmed?null:{id,state:'pending',expires_at:new Date(Date.now()+900000).toISOString()},withdrawal_percent:confirmed?75:0,charges:[{id,amount_sen:1501,percent:75,is_current:true,status:'paid',fee_version:1,payments:[{id,amount_sen:1501,status:'approved',method:'cash',created_at:new Date().toISOString(),refund_status:'pending',refund_reason:'Synthetic cancellation'}]}],bank:null,server_now:new Date().toISOString()}})
  })
  await page.goto(`/guest/access#token=${token}`);await page.getByRole('button',{name:'Open private invitation',exact:true}).click()
  await page.getByRole('button',{name:'Continue',exact:true}).focus();await page.keyboard.press('Enter')
  await expect(page.getByText('Confirmed',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Withdraw from session',exact:true}).click();await expect(page.getByText('The applicable charge is 75%',{exact:false})).toBeVisible()
  expect(withdrawn).toBe(false);await page.getByRole('button',{name:'Confirm withdrawal',exact:true}).click();await expect(page.getByText('Late cancelled',{exact:true})).toBeVisible()
  await expect(page.getByText('RM 15.01',{exact:false}).first()).toBeVisible();await expect(page.getByText('Manual refund pending',{exact:true})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:`.superpowers/task7-guest-fixture-${info.project.name}.png`,fullPage:true})
})
test('admin recovery requires independent verification and provides only manual sharing',async({page})=>{
  await authFixture(page,'active');await page.route('**/rest/v1/rpc/get_my_membership',r=>r.fulfill({json:[{user_id:id,display_name:'Bear',role:'admin',status:'active'}]}))
  await page.route('**/rest/v1/rpc/get_guest_management',r=>r.fulfill({json:{guests:[],members:[{id,display_name:'Synthetic Member',phone:'+60112345678',status:'active'}]}}))
  let issued=0;await page.route('**/functions/v1/account-recovery',r=>{issued++;expect(r.request().postDataJSON().verified).toBe(true);return r.fulfill({json:{token,expires_at:new Date(Date.now()+900000).toISOString()}})})
  await login(page);await expect(page.getByRole('heading',{name:'Welcome back, Bear.'})).toBeVisible();await page.goto('/admin/recovery')
  await page.getByLabel('Verified account',{exact:true}).selectOption(id);await page.getByLabel('Identity verification reason',{exact:true}).fill('Synthetic in-person verification')
  await expect(page.getByRole('button',{name:'Issue private reset link',exact:true})).toBeDisabled();expect(issued).toBe(0)
  await page.getByLabel('I verified this member’s identity outside the app.').check();await page.getByRole('button',{name:'Issue private reset link',exact:true}).click()
  await expect(page.getByText('No message has been sent.',{exact:false})).toBeVisible();expect(issued).toBe(1)
  await page.getByRole('button',{name:'Hide link',exact:true}).click();await expect(page.getByLabel('Private access link')).toHaveCount(0)
})
test('reset strips token, validates confirmation and keeps provider errors generic',async({page})=>{
  await authFixture(page);let calls=0
  await page.route('**/functions/v1/account-recovery',r=>{calls++;return r.fulfill({status:403,json:{error:'RECOVERY_UNAVAILABLE',private:'sensitive provider diagnostic'}})})
  await page.goto(`/recovery#token=${token}`);await expect(page).toHaveURL(/\/recovery$/)
  await page.getByLabel('New password',{exact:true}).fill('Synthetic-long-password');await page.getByLabel('Confirm new password').fill('Different-long-password');await page.getByRole('button',{name:'Set new password',exact:true}).click();await expect(page.getByRole('alert')).toContainText('do not match');expect(calls).toBe(0)
  await page.getByLabel('Confirm new password').fill('Synthetic-long-password');await page.getByRole('button',{name:'Set new password',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Contact your club admin')
  await expect(page.getByText('sensitive provider diagnostic')).toHaveCount(0);expect(calls).toBe(1)
})

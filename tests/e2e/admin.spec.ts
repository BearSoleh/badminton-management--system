import { expect,test } from '@playwright/test'
import { authFixture,login } from '../helpers/browser-auth'
const id='80000000-0000-4000-8000-000000000001',target='80000000-0000-4000-8000-000000000002'
async function admin(page:Parameters<typeof authFixture>[0]){await authFixture(page,'active');await page.route('**/rest/v1/rpc/get_my_membership',r=>r.fulfill({json:[{user_id:id,display_name:'Bear',role:'admin',status:'active'}]}));await login(page);await expect(page.getByRole('heading',{name:'Welcome back, Bear.'})).toBeVisible()}
test('admin overview renders exact server aggregates and distinguishes pending/refunded money',async({page},info)=>{
  await admin(page);await page.route('**/rest/v1/rpc/get_admin_dashboard',r=>r.fulfill({json:{received_sen:'900719925474099301',outstanding_sen:'2001',pending_refund_sen:'1501',refunded_sen:'500',retained_sen:'900719925474098801',pending_members:1,active_members:2,pending_receipts:3,upcoming_sessions:4,server_now:new Date().toISOString()}}))
  await page.goto('/admin');await expect(page.getByRole('heading',{name:'Club overview'})).toBeVisible();await expect(page.getByText('RM 9,007,199,254,740,993.01',{exact:true})).toBeVisible();await expect(page.getByText('Pending receipts are not received money.',{exact:false})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  for(const metric of await page.locator('.admin-totals dd').all())expect(await metric.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
  await page.screenshot({path:`.superpowers/task8-overview-${info.project.name}.png`,fullPage:true})
})
test('member approval needs reason/confirmation and handles a stale status safely',async({page})=>{
  await admin(page);const member={user_id:target,display_name:'Synthetic Applicant',phone:'+60112345678',status:'pending',role:'member',created_at:new Date().toISOString(),updated_at:new Date().toISOString()}
  await page.route('**/rest/v1/rpc/get_admin_members',r=>r.fulfill({json:{total:1,page:0,members:[member]}}));let calls=0
  await page.route('**/rest/v1/rpc/admin_set_membership',r=>{calls++;return r.fulfill({status:400,json:{message:'MEMBERSHIP_STALE'}})})
  await page.goto('/admin/members');const article=page.getByRole('article').filter({has:page.getByRole('heading',{name:'Synthetic Applicant'})})
  await expect(article.getByRole('button',{name:'Save membership'})).toBeDisabled();await article.getByLabel('Reason for Synthetic Applicant').fill('Synthetic reviewed request');await article.getByLabel('I reviewed this role and membership change for Synthetic Applicant.').check();await article.getByRole('button',{name:'Save membership'}).click();await expect(article.getByRole('alert')).toContainText('This member changed');expect(calls).toBe(1)
})
test('settings requires recipient confirmation and shows revision conflict without hiding edits',async({page})=>{
  await admin(page);await page.route('**/rest/v1/rpc/get_admin_settings',r=>r.fulfill({json:{revision:0,bank_name:null,bank_account_name:null,bank_account_number:null,qr_object_path:null}}));await page.route('**/rest/v1/rpc/save_club_settings',r=>r.fulfill({status:400,json:{message:'SETTINGS_STALE'}}))
  await page.goto('/admin/settings');await page.getByLabel('Bank name',{exact:true}).fill('Synthetic Bank');await page.getByLabel('Bank account name').fill('Synthetic Club');await page.getByLabel('Bank account number').fill('00000000');await page.getByLabel('Settings change reason').fill('Synthetic recipient review');await expect(page.getByRole('button',{name:'Save payment instructions'})).toBeDisabled();await page.getByLabel('I checked these bank details and QR recipient.').check();await page.getByRole('button',{name:'Save payment instructions'}).click();await expect(page.getByRole('alert')).toContainText('Bank settings changed');await expect(page.getByLabel('Bank name',{exact:true})).toHaveValue('Synthetic Bank')
})
test('audit records render escaped metadata and nested admin navigation refreshes',async({page})=>{
  await admin(page);await page.route('**/rest/v1/rpc/get_admin_audit',r=>r.fulfill({json:{total:1,events:[{id,created_at:new Date().toISOString(),action:'membership_changed',entity:'memberships',entity_id:target,actor_name:'Synthetic Admin',reason:'Reviewed request',safe_metadata:{note:'<script>unsafe()</script>'}}]}}))
  await page.goto('/admin/audit');await page.reload();await expect(page.getByRole('heading',{name:'membership changed',exact:true})).toBeVisible();await page.getByText('Record details',{exact:true}).click();await expect(page.locator('pre')).toContainText('<script>unsafe()</script>');expect(await page.locator('main script').count()).toBe(0);await page.getByRole('link',{name:'Members',exact:true}).focus();await expect(page.getByRole('link',{name:'Members',exact:true})).toBeFocused()
})

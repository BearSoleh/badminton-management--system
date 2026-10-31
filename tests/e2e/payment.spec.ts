import { expect,test } from '@playwright/test'
import { authFixture,login } from '../helpers/browser-auth'
const cid='60000000-0000-4000-8000-000000000001',uid='60000000-0000-4000-8000-000000000002',pid='60000000-0000-4000-8000-000000000003'
const base={id:cid,session_id:cid,participant_id:uid,fee_version_id:cid,amount_sen:2001,percent:100,is_current:true,status:'unpaid',session_title:'Synthetic receipt game',session_status:'completed',starts_at:'2026-10-30T12:00:00Z',created_at:'2026-10-30T15:00:00Z',fee_version:1,display_name:'Synthetic Player',payments:[]}

test('member uploads privately, retries the same submission and sees rejection/resubmission history',async({page},info)=>{
  await authFixture(page,'active')
  let pending=false,rejected=false
  await page.route('**/rest/v1/rpc/get_payment_history',r=>r.fulfill({json:[{...base,status:pending?'pending_verification':'unpaid',payments:pending||rejected?[{id:pid,method:'transfer',amount_sen:2001,status:pending?'submitted':'rejected',receipt_object_path:`${uid}/${cid}/${pid}.pdf`,created_at:base.created_at,rejection_reason:rejected?'No matching transfer':null,refund_status:'none'}]:[]}]}))
  await page.route('**/rest/v1/club_settings?**',r=>r.fulfill({json:[{bank_name:'Synthetic Test Bank',bank_account_name:'Synthetic Club',bank_account_number:'0000000000',qr_object_path:null}]}))
  const uploads:string[]=[],requests:{path:string;requestId:string}[]=[]
  await page.route('**/storage/v1/object/receipts/**',r=>{uploads.push(r.request().url());return r.fulfill({json:{Key:'receipts/uploaded',Id:pid}})})
  await page.route('**/functions/v1/receipt-submit',r=>{
    requests.push(r.request().postDataJSON());if(requests.length===1)return r.fulfill({status:503,json:{error:'private diagnostic'}})
    pending=true;rejected=false;return r.fulfill({json:{payment_id:pid,status:'submitted'}})
  })
  await login(page);await expect(page.getByRole('heading',{name:'Welcome back, Bear.'})).toBeVisible();await page.goto(`/app/payments/${cid}`)
  await expect(page.getByRole('heading',{name:'Synthetic receipt game'})).toBeVisible()
  await expect(page.getByText('Synthetic Test Bank')).toBeVisible()
  await page.getByLabel('Receipt file').setInputFiles({name:'unsafe.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')})
  await expect(page.getByRole('alert')).toContainText('JPEG, PNG or PDF')
  await page.getByLabel('Receipt file').setInputFiles({name:'receipt.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nSynthetic\n%%EOF')})
  await page.getByRole('button',{name:'Submit for verification',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('try again')
  await expect(page.getByText('private diagnostic')).toHaveCount(0)
  await page.getByRole('button',{name:'Submit for verification',exact:true}).click()
  await expect(page.getByText('Pending verification',{exact:true}).first()).toBeVisible()
  expect(uploads).toHaveLength(1);expect(requests[0]).toEqual(requests[1])
  pending=false;rejected=true;await page.getByRole('button',{name:'Refresh payments',exact:true}).click()
  await expect(page.getByText('No matching transfer')).toBeVisible()
  await expect(page.getByLabel('Receipt file')).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:`.superpowers/task6-member-${info.project.name}.png`,fullPage:true})
})

test('admin must check bank, gives rejection reasons, records full cash and actual refunds',async({page},info)=>{
  await authFixture(page,'active')
  await page.route('**/rest/v1/rpc/get_my_membership',r=>r.fulfill({json:[{user_id:uid,display_name:'Bear',role:'admin',status:'active'}]}))
  let state='submitted',refund='none',cash=false
  await page.route('**/rest/v1/rpc/get_payment_history',r=>r.fulfill({json:[{...base,status:cash?'paid':state==='submitted'?'pending_verification':'unpaid',payments:[{id:pid,status:cash?'approved':state,method:cash?'cash':'transfer',amount_sen:2001,created_at:base.created_at,receipt_object_path:cash?null:`${uid}/${cid}/${pid}.pdf`,rejection_reason:state==='rejected'?'Wrong reference':null,refund_status:refund}]}]}))
  const decisions:unknown[]=[]
  await page.route('**/rest/v1/rpc/review_payment',r=>{const b=r.request().postDataJSON();decisions.push(b);state=b.approve_input?'approved':'rejected';return r.fulfill({json:{}})})
  await page.route('**/rest/v1/rpc/record_cash_payment',r=>{expect(r.request().postDataJSON().reason_input).toBe('Full cash received');cash=true;refund='pending';return r.fulfill({json:{}})})
  await page.route('**/rest/v1/rpc/record_payment_refund',r=>{expect(r.request().postDataJSON().reason_input).toBe('Returned in full, test reference');refund='refunded';return r.fulfill({json:{}})})
  await page.route('**/functions/v1/receipt-view',r=>r.fulfill({json:{url:'http://127.0.0.1:54321/storage/v1/object/sign/receipts/synthetic?token=synthetic',expiresIn:60}}))
  await login(page);await expect(page.getByRole('heading',{name:'Welcome back, Bear.'})).toBeVisible();await page.goto('/admin/payments')
  await expect(page.getByRole('heading',{name:'Verify payments'})).toBeVisible()
  await expect(page.getByRole('button',{name:'Approve payment',exact:true})).toBeDisabled()
  await page.getByRole('button',{name:'Get receipt download',exact:true}).click()
  await expect(page.getByRole('link',{name:'Download receipt (valid for 60 seconds)'})).toBeVisible()
  await page.getByLabel('I checked this full amount against the bank transaction.').check()
  await expect(page.getByRole('button',{name:'Approve payment',exact:true})).toBeEnabled()
  await page.getByLabel('Review reason or bank reference').fill('Wrong reference')
  await page.getByRole('button',{name:'Reject receipt',exact:true}).click()
  expect(decisions).toHaveLength(1)
  await page.getByLabel('Cash receipt reason').fill('Full cash received')
  await page.getByLabel('I received the full amount in cash.').check()
  await page.getByRole('button',{name:'Record full cash payment',exact:true}).click()
  await expect(page.getByText('Manual refund pending',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Record actual full refund',exact:true})).toBeDisabled()
  await page.getByLabel('Refund reason and reference').fill('Returned in full, test reference')
  await page.getByLabel('I have returned the full payment to the player.').check()
  await page.getByRole('button',{name:'Record actual full refund',exact:true}).click()
  await expect(page.getByText('Full refund recorded',{exact:true})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:`.superpowers/task6-admin-${info.project.name}.png`,fullPage:true})
})

test('suspended member can open own payment history from account status',async({page})=>{
  await authFixture(page,'suspended')
  await page.route('**/rest/v1/rpc/get_payment_history',r=>r.fulfill({json:[base]}))
  await login(page)
  await page.getByRole('link',{name:'Your payments',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Your payments'})).toBeVisible()
  await expect(page.getByRole('link',{name:'Synthetic receipt game'})).toBeVisible()
  await expect(page.getByRole('link',{name:'Sessions',exact:true})).toHaveCount(0)
})

test('paid fee correction requires explicit full-refund acknowledgement and a reviewed version',async({page})=>{
  await authFixture(page,'active')
  await page.route('**/rest/v1/rpc/get_my_membership',r=>r.fulfill({json:[{user_id:uid,display_name:'Bear',role:'admin',status:'active'}]}))
  const session={id:cid,title:'Synthetic paid correction',operational_status:'completed',billing_status:'published',starts_at:'2026-10-01T12:00:00Z',ends_at:'2026-10-01T14:00:00Z'}
  await page.route('**/rest/v1/rpc/get_fee_preview',r=>r.fulfill({json:{session,server_now:'2026-10-02T00:00:00Z',costs:{full_fee_sen:2500,court_cost_sen:0,shuttle_quantity:0,shuttle_cost_sen:0,notes:''},latest_version:1,unmarked_count:0,review_token:'paid-token',rows:[{participant_id:uid,display_name:'Synthetic Player',participation_status:'confirmed',attendance:'present',percent:100,amount_sen:2500}],financial_payments:[{payment_id:pid,charge_id:cid,amount_sen:2001,status:'approved',refund_status:'none'}]}}))
  await page.route('**/rest/v1/rpc/save_fee_draft',r=>r.fulfill({json:{}}))
  await page.route('**/rest/v1/rpc/adjust_session_fee',r=>{expect(r.request().postDataJSON()).toMatchObject({refund_ack_input:true,full_fee_sen_input:2500,reason_input:'Correct court cost',review_token_input:'paid-token'});return r.fulfill({json:{version:2}})})
  await login(page);await expect(page.getByRole('heading',{name:'Welcome back, Bear.'})).toBeVisible();await page.goto(`/admin/sessions/${cid}/attendance`)
  await page.getByLabel('Fee correction reason').fill('Correct court cost')
  await page.getByRole('button',{name:'Review charges',exact:true}).click()
  await page.getByLabel('I reviewed every participant’s charge.').check()
  await expect(page.getByRole('button',{name:'Publish fee adjustment',exact:true})).toBeDisabled()
  await expect(page.getByRole('region',{name:'Charge preview'})).toContainText('RM 20.01')
  await page.getByLabel('I will return the full received payments manually and collect the replacement full charges.').check()
  await page.getByRole('button',{name:'Publish fee adjustment',exact:true}).click()
  await expect(page.getByText('Published fee version 2.',{exact:true})).toBeVisible()
})

test('cancelled session does not claim a retained late-cancellation obligation',async({page})=>{
  await authFixture(page,'active')
  await page.route('**/rest/v1/rpc/get_session_snapshot',r=>r.fulfill({json:{session:{id:cid,title:'Synthetic cancelled game',venue:'Test court',voting_closes_at:'2026-09-30T12:00:00Z',starts_at:'2026-10-01T12:00:00Z',ends_at:'2026-10-01T14:00:00Z',capacity:2,operational_status:'cancelled',billing_status:'not_published'},server_now:'2026-10-02T00:00:00Z',participation:{id:uid,participation_status:'late_cancelled',liability_percent:75},roster:[],counts:{confirmed:0,held:0,waiting:0},can_vote:false,can_join:false,can_withdraw:false}}))
  await login(page);await expect(page.getByRole('heading',{name:'Welcome back, Bear.'})).toBeVisible();await page.goto(`/app/sessions/${cid}`)
  await expect(page.getByText('Cancelled',{exact:true})).toBeVisible()
  await expect(page.getByText('No charge — session cancelled.',{exact:true})).toBeVisible()
  await expect(page.locator('.retained-liability')).toHaveCount(0)
})

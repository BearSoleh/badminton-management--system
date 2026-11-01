import { expect,test } from '@playwright/test'
import { guestFixture } from '../helpers/guest-fixture'
import { receiptPdf } from '../helpers/payment-fixture'
import { fillPrivate,openPrivateLink } from '../helpers/private-browser'
import { randomUUID } from 'node:crypto'
import { localSql,sqlLiteral as q } from '../helpers/local-sql'

test('real sponsor invitation, private guest place, free withdrawal and reload boundary',async({page},info)=>{
  const f=await guestFixture()
  try {
    const sid=await f.session()
    await page.goto('/login');await page.getByLabel('Phone number').fill(f.actors[1].phone);await fillPrivate(page.getByLabel('Password',{exact:true}),f.actors[1].password);await page.getByRole('button',{name:'Log in',exact:true}).click();await expect(page.getByRole('heading',{name:'Welcome back, Synthetic Billing Player 1.'})).toBeVisible()
    await page.getByRole('link',{name:'Invite a guest',exact:true}).click();await page.getByLabel('Guest name or nickname').fill('Synthetic Browser Guest');await page.getByLabel('Guest phone number').fill(`+60114${String(Date.now()).slice(-7)}`);await page.getByLabel('Invited session').selectOption(sid);await page.getByRole('button',{name:'Create guest invitation',exact:true}).click()
    const link=await page.getByLabel('Private access link').inputValue();await openPrivateLink(page,link);await expect(page).toHaveURL(/\/guest\/access$/)
    await page.getByRole('button',{name:'Open private invitation',exact:true}).click();await page.getByRole('button',{name:'Join this session',exact:true}).click();await expect(page.getByText('Confirmed',{exact:true})).toBeVisible()
    expect(await page.evaluate(()=>Object.values(localStorage).some(v=>v.includes('X-BJBC-Guest')))).toBe(false)
    await page.getByRole('button',{name:'Withdraw from session',exact:true}).click();await expect(page.getByText('This withdrawal has no charge.',{exact:false})).toBeVisible();await page.getByRole('button',{name:'Confirm withdrawal',exact:true}).click();await expect(page.getByText('Withdrawn early',{exact:true})).toBeVisible()
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`.superpowers/task7-guest-live-${info.project.name}.png`,fullPage:true})
    await page.reload();await expect(page.getByRole('heading',{name:'Invitation unavailable',exact:true})).toBeVisible()
  }finally{await f.cleanup()}
})
test('real guest offer consent, receipt/bank approval and verified duplicate linking retain history',async({page},info)=>{
  const f=await guestFixture()
  try {
    const sid=await f.session(1),member=f.actors[1].client
    const voted=await member.rpc('cast_session_vote',{session_id_input:sid,choice_input:'play',request_id:randomUUID()});expect(voted.error).toBeNull()
    const i=await f.invite(sid)
    await openPrivateLink(page,`http://127.0.0.1:5173/guest/access#token=${i.token}`);await page.getByRole('button',{name:'Open private invitation',exact:true}).click();await page.getByRole('button',{name:'Join this session',exact:true}).click();await expect(page.getByText('Waiting list',{exact:true})).toBeVisible()
    expect((await member.rpc('withdraw_participation',{participant_id_input:voted.data.participant_id,request_id:randomUUID()})).error).toBeNull()
    await page.getByRole('button',{name:'Refresh session and payments',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByText('Confirmed',{exact:true})).toBeVisible()
    // Fixture clock moves only this synthetic session; actual UI/API remain real.
    localSql(`update public.sessions set starts_at=clock_timestamp()-interval '3 hours',ends_at=clock_timestamp()-interval '1 hour',voting_closes_at=clock_timestamp()-interval '4 hours' where id=${q(sid)}`)
    const pid=localSql(`select p.id from public.participants p join public.players pl on pl.id=p.player_id where session_id=${q(sid)} and pl.guest_id=${q(i.guest_id)}`),admin=f.actors[0].client
    expect((await admin.rpc('set_attendance',{participant_id_input:pid,attendance_input:'present',reason_input:'',request_id:randomUUID()})).error).toBeNull()
    expect((await admin.rpc('save_fee_draft',{session_id_input:sid,full_fee_sen_input:2001,court_cost_sen_input:0,shuttle_quantity_input:0,shuttle_cost_sen_input:0,notes_input:'Synthetic guest fee',request_id:randomUUID()})).error).toBeNull()
    const preview=await admin.rpc('get_fee_preview',{session_id_input:sid});expect((await admin.rpc('publish_session_fee',{session_id_input:sid,full_fee_sen_input:2001,review_token_input:preview.data.review_token,reason_input:'',request_id:randomUUID()})).error).toBeNull()
    await page.getByRole('button',{name:'Refresh session and payments',exact:true}).click();await page.getByLabel('Receipt file').setInputFiles({name:'synthetic.pdf',mimeType:'application/pdf',buffer:Buffer.from(receiptPdf)});await page.getByRole('button',{name:'Submit for verification',exact:true}).click();await expect(page.getByText('100% · Pending verification',{exact:true})).toBeVisible()
    await page.goto('/login');await page.getByLabel('Phone number').fill(f.actors[0].phone);await fillPrivate(page.getByLabel('Password',{exact:true}),f.actors[0].password);await page.getByRole('button',{name:'Log in',exact:true}).click();await expect(page.getByRole('heading',{name:'Welcome back, Synthetic Billing Admin.'})).toBeVisible();await page.goto('/admin/payments')
    const panel=page.getByRole('article',{name:'Synthetic Guest, Synthetic Task 7 game, version 1',exact:true});await panel.getByLabel('I checked this full amount against the bank transaction.').check();await panel.getByRole('button',{name:'Approve payment',exact:true}).click();await expect(panel.getByText('Paid',{exact:true})).toBeVisible()
    await page.goto('/admin/guests');await page.getByLabel('Guest',{exact:true}).selectOption(i.guest_id);await page.getByLabel('Verification reason',{exact:true}).fill('Synthetic identity verified face to face');await page.getByLabel('Verified member account',{exact:true}).selectOption(f.actors[1].uid);await expect(page.getByRole('button',{name:'Verify and link guest',exact:true})).toBeDisabled();await page.getByLabel('I verified this guest’s identity outside the app.').check();await page.getByRole('button',{name:'Verify and link guest',exact:true}).click();await expect(page.getByRole('status')).toContainText('Guest history linked');await expect(page.getByRole('button',{name:'Reissue invitation',exact:true})).toBeDisabled()
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`.superpowers/task7-admin-linked-${info.project.name}.png`,fullPage:true})
    expect(localSql(`select count(*) from public.participants where session_id=${q(sid)} and merged_into_id is not null`)).toBe('1')
    const payment=await f.operator.from('payments').select('status,amount_sen').in('charge_id',(await f.operator.from('charges').select('id').eq('session_id',sid)).data!.map(c=>c.id));expect(payment.data).toEqual([{status:'approved',amount_sen:2001}])
  }finally{await f.cleanup()}
})
test('real admin verified recovery resets once and preserves suspended membership',async({page})=>{
  const f=await guestFixture()
  try {
    const target=f.actors[3];localSql(`update public.memberships set status='suspended' where user_id=${q(target.uid)}`)
    await page.goto('/login');await page.getByLabel('Phone number').fill(f.actors[0].phone);await fillPrivate(page.getByLabel('Password',{exact:true}),f.actors[0].password);await page.getByRole('button',{name:'Log in',exact:true}).click();await expect(page.getByRole('heading',{name:'Welcome back, Synthetic Billing Admin.'})).toBeVisible();await page.goto('/admin/recovery')
    await page.getByLabel('Verified account',{exact:true}).selectOption(target.uid);await page.getByLabel('Identity verification reason',{exact:true}).fill('Synthetic established contact verified');await page.getByLabel('I verified this member’s identity outside the app.').check();await page.getByRole('button',{name:'Issue private reset link',exact:true}).click();const link=await page.getByLabel('Private access link').inputValue()
    await page.getByRole('button',{name:'Log out',exact:true}).click();await openPrivateLink(page,link);await expect(page).toHaveURL(/\/recovery$/)
    const password=`Synthetic-new-${randomUUID()}`;await fillPrivate(page.getByLabel('New password',{exact:true}),password);await fillPrivate(page.getByLabel('Confirm new password'),password);await page.getByRole('button',{name:'Set new password',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('status')).toContainText('Password updated.')
    await page.getByRole('link',{name:'Back to login',exact:true}).click();await page.getByLabel('Phone number').fill(target.phone);await fillPrivate(page.getByLabel('Password',{exact:true}),password);await page.getByRole('button',{name:'Log in',exact:true}).click();await expect(page.getByRole('heading',{name:'Membership suspended',exact:true})).toBeVisible()
    expect(localSql(`select count(*) from public.audit_logs where entity_id=${q(target.uid)} and action='recovery_completed'`)).toBe('1')
  }finally{await f.cleanup()}
})

import { expect,test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomBytes,randomUUID } from 'node:crypto'
import { adminFixture,qrPng } from '../helpers/admin-fixture'
import { receiptPdf } from '../helpers/payment-fixture'
import { fillPrivate,openPrivateLink } from '../helpers/private-browser'
import { localSql,sqlLiteral as q } from '../helpers/local-sql'

test('full real pilot: signup, approval, settings, queue expiry/decline, guest, late/no-show and settled money',async({page},info)=>{
  test.setTimeout(150000)
  const f=await adminFixture()
  const login=async(index:number)=>{await page.goto('/login');await page.getByLabel('Phone number').fill(f.actors[index].phone);await fillPrivate(page.getByLabel('Password',{exact:true}),f.actors[index].password);await page.getByRole('button',{name:'Log in',exact:true}).click();await expect(page.getByRole('link',{name:'Payments',exact:true})).toBeVisible()}
  const logout=async()=>{await page.goto('/app');await page.getByRole('button',{name:'Log out',exact:true}).click();await expect(page.getByRole('heading',{name:'Good to see you.'})).toBeVisible()}
  try{
    const client=createClient(process.env.SUPABASE_TEST_URL!,process.env.SUPABASE_TEST_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}}),phone=`+60115${String(Date.now()).slice(-7)}`,password=randomBytes(24).toString('base64url')
    const signup=await client.auth.signUp({phone,password,options:{data:{display_name:'Synthetic Pilot Applicant'}}});if(signup.data.user)f.actors.push({uid:signup.data.user.id,phone,password,client});expect(signup.error).toBeNull();expect(signup.data.session).not.toBeNull()
    const applicant=f.actors.length-1
    await login(0);await page.getByRole('link',{name:'Members',exact:true}).click();const member=page.getByRole('article').filter({has:page.getByRole('heading',{name:'Synthetic Pilot Applicant',exact:true})})
    await member.getByLabel('Reason for Synthetic Pilot Applicant').fill('Synthetic independent identity and club approval');await member.getByLabel('I reviewed this role and membership change for Synthetic Pilot Applicant.').check();await member.getByRole('button',{name:'Save membership'}).focus();await page.keyboard.press('Enter');await expect(member.getByText(`${phone} · active · member`,{exact:true})).toBeVisible()
    await page.getByRole('link',{name:'Payment settings',exact:true}).click();await page.getByLabel('Bank name',{exact:true}).fill('Synthetic Pilot Bank');await page.getByLabel('Bank account name').fill('Synthetic Club');await page.getByLabel('Bank account number').fill('0000000000');await page.getByLabel('Private payment QR image',{exact:false}).setInputFiles({name:'synthetic-qr.png',mimeType:'image/png',buffer:Buffer.from(qrPng)});await expect(page.getByText('verified for the next save',{exact:false})).toBeVisible();await page.getByLabel('Settings change reason').fill('Synthetic QR and bank recipient checked');await page.getByLabel('I checked these bank details and QR recipient.').check();await page.getByRole('button',{name:'Save payment instructions'}).click();await expect(page.getByRole('status')).toContainText('Payment instructions saved');await page.reload();await expect(page.getByLabel('Bank name',{exact:true})).toHaveValue('Synthetic Pilot Bank');await logout()
    const a=await f.session(1),b=await f.session(3),admin=f.actors[0].client
    const vote=async(actor:number,sid:string)=>{const r=await f.actors[actor].client.rpc('cast_session_vote',{session_id_input:sid,choice_input:'play',request_id:randomUUID()});expect(r.error).toBeNull();return r.data.participant_id as string}
    const first=await vote(1,a),decline=await vote(2,a),expire=await vote(applicant,a),invitation=await f.invite(a),guestToken=await f.exchange(invitation.token)
    expect((await f.action(guestToken,'join')).status).toBe(200);expect((await f.actors[1].client.rpc('withdraw_participation',{participant_id_input:first,request_id:randomUUID()})).error).toBeNull()
    const offerId=(pid:string)=>localSql(`select id from public.waitlist_offers where participant_id=${q(pid)} and state='pending'`)
    expect((await f.actors[2].client.rpc('respond_to_offer',{offer_id_input:offerId(decline),accept_input:false,request_id:randomUUID()})).error).toBeNull()
    localSql(`update public.waitlist_offers set offered_at=statement_timestamp()-interval '16 minutes',expires_at=statement_timestamp()-interval '1 minute' where id=${q(offerId(expire))}`)
    expect((await f.operator.rpc('expire_waitlist_offers')).error).toBeNull();expect((await f.action(guestToken,'respond',{accept:true})).status).toBe(200)
    const late=await vote(1,b),absent=await vote(2,b),present=await vote(applicant,b)
    localSql(`update public.sessions set starts_at=((clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date+time '23:59:59') at time zone 'Asia/Kuala_Lumpur',ends_at=clock_timestamp()+interval '2 days',voting_closes_at=clock_timestamp()-interval '1 minute' where id=${q(b)}`)
    expect((await f.actors[1].client.rpc('withdraw_participation',{participant_id_input:late,request_id:randomUUID()})).data.charge_percent).toBe(75)
    const guestPid=localSql(`select p.id from public.participants p join public.players pl on pl.id=p.player_id where p.session_id=${q(a)} and pl.guest_id=${q(invitation.guest_id)}`)
    for(const sid of [a,b])localSql(`update public.sessions set starts_at=clock_timestamp()-interval '3 hours',ends_at=clock_timestamp()-interval '1 hour',voting_closes_at=clock_timestamp()-interval '4 hours' where id=${q(sid)}`)
    for(const [pid,state] of [[guestPid,'present'],[absent,'no_show'],[present,'present']])expect((await admin.rpc('set_attendance',{participant_id_input:pid,attendance_input:state,reason_input:'',request_id:randomUUID()})).error).toBeNull()
    for(const sid of [a,b]){expect((await admin.rpc('save_fee_draft',{session_id_input:sid,full_fee_sen_input:2001,court_cost_sen_input:0,shuttle_quantity_input:0,shuttle_cost_sen_input:0,notes_input:'Synthetic manually chosen pilot fee',request_id:randomUUID()})).error).toBeNull();const preview=await admin.rpc('get_fee_preview',{session_id_input:sid});expect((await admin.rpc('publish_session_fee',{session_id_input:sid,full_fee_sen_input:2001,review_token_input:preview.data.review_token,reason_input:'',request_id:randomUUID()})).error).toBeNull()}
    const charges=(await f.operator.from('charges').select('*').in('session_id',[a,b])).data!,charge=(pid:string)=>charges.find(c=>c.participant_id===pid)!
    expect(charge(late).amount_sen).toBe(1501);expect(charge(absent).amount_sen).toBe(2001);expect(charge(decline).amount_sen).toBe(0);expect(charge(expire).amount_sen).toBe(0)
    await login(applicant);await page.goto(`/app/payments/${charge(present).id}`);await page.getByLabel('Receipt file').setInputFiles({name:'synthetic-pilot.pdf',mimeType:'application/pdf',buffer:Buffer.from(receiptPdf)});await page.getByRole('button',{name:'Submit for verification'}).click();await expect(page.getByText('Pending verification',{exact:true}).first()).toBeVisible();await logout()
    let payment=(await f.operator.from('payments').select('*').eq('charge_id',charge(present).id).single()).data!
    expect((await admin.rpc('review_payment',{payment_id_input:payment.id,approve_input:false,bank_checked_input:false,reason_input:'Synthetic no bank match yet',request_id:randomUUID()})).error).toBeNull()
    await login(applicant);await page.goto(`/app/payments/${charge(present).id}`);await expect(page.getByText('Synthetic no bank match yet')).toBeVisible();await page.getByLabel('Receipt file').setInputFiles({name:'synthetic-resubmission.pdf',mimeType:'application/pdf',buffer:Buffer.from(receiptPdf)});await page.getByRole('button',{name:'Submit for verification'}).click();await expect(page.getByText('Pending verification',{exact:true}).first()).toBeVisible();await logout()
    payment=(await f.operator.from('payments').select('*').eq('charge_id',charge(present).id).eq('status','submitted').single()).data!
    expect((await admin.rpc('review_payment',{payment_id_input:payment.id,approve_input:true,bank_checked_input:true,reason_input:'Synthetic full bank transaction checked',request_id:randomUUID()})).error).toBeNull()
    for(const pid of [late,absent])expect((await admin.rpc('record_cash_payment',{charge_id_input:charge(pid).id,reason_input:'Synthetic full cash actually received',request_id:randomUUID()})).error).toBeNull()
    const access=await f.invite(a,invitation.guest_id);await openPrivateLink(page,`http://127.0.0.1:5173/guest/access#token=${access.token}`);await page.getByRole('button',{name:'Open private invitation'}).click();await page.getByLabel('Receipt file').setInputFiles({name:'synthetic-guest.pdf',mimeType:'application/pdf',buffer:Buffer.from(receiptPdf)});await page.getByRole('button',{name:'Submit for verification'}).click();await expect(page.getByText('100% · Pending verification',{exact:true})).toBeVisible()
    const guestPayment=(await f.operator.from('payments').select('*').eq('charge_id',charge(guestPid).id).single()).data!;expect((await admin.rpc('review_payment',{payment_id_input:guestPayment.id,approve_input:true,bank_checked_input:true,reason_input:'Synthetic guest bank match',request_id:randomUUID()})).error).toBeNull()
    await login(0);await page.goto('/admin');const total=(label:string)=>page.locator('.admin-totals > div').filter({has:page.getByText(label,{exact:true})}).getByRole('definition');await expect(total('Received · approved payments')).toHaveText('RM 75.04');await expect(total('Outstanding · current charges')).toHaveText('RM 0.00')
    expect((await admin.rpc('cancel_session',{session_id_input:a,reason_input:'Synthetic post-payment cancellation',request_id:randomUUID()})).error).toBeNull();await page.getByRole('button',{name:'Refresh overview'}).click();await expect(total('Manual refunds pending')).toHaveText('RM 20.01')
    expect((await admin.rpc('record_payment_refund',{payment_id_input:guestPayment.id,reason_input:'Synthetic full guest refund returned',request_id:randomUUID()})).error).toBeNull();await page.getByRole('button',{name:'Refresh overview'}).click();await expect(total('Refunds actually returned')).toHaveText('RM 20.01');await expect(total('Retained after actual refunds')).toHaveText('RM 55.03');await expect(total('Manual refunds pending')).toHaveText('RM 0.00');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`.superpowers/task8-pilot-${info.project.name}.png`,fullPage:true})
    await page.getByRole('link',{name:'Audit history',exact:true}).first().click();await page.getByLabel('Filter by action').fill('club_settings');await page.getByRole('button',{name:'Filter audit'}).click();await expect(page.getByRole('heading',{name:'club settings changed',exact:true})).toBeVisible();await page.reload();await expect(page.getByRole('heading',{name:'Audit history',exact:true})).toBeVisible()
  }finally{
    // Browser member uploads are insert-only; remove every exact fixture-owned
    // object through Storage before deleting immutable financial records.
    const ids=f.actors.map(a=>q(a.uid)).join(','),paths=JSON.parse(localSql(`select coalesce(jsonb_agg(name),'[]') from storage.objects where bucket_id='receipts' and owner_id in (${ids})`)) as string[]
    if(paths.length)expect((await f.operator.storage.from('receipts').remove(paths)).error).toBeNull();localSql(`delete from app_private.receipt_checks where owner_id in (${ids})`)
    await f.cleanup()
  }
})

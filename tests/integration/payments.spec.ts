import { randomUUID } from 'node:crypto'
import { afterAll,beforeAll,describe,expect,it } from 'vitest'
import { paymentFixture,receiptPdf } from '../helpers/payment-fixture'
import { holdSession,financialCallsBlocked } from '../helpers/financial-lock'
import { localSql,sqlLiteral as q } from '../helpers/local-sql'
let f:Awaited<ReturnType<typeof paymentFixture>>
const request=()=>randomUUID()
const review=(pid:string,approve=true,checked=true,reason='',rid=request())=>f.actors[0].client.rpc('review_payment',{payment_id_input:pid,approve_input:approve,bank_checked_input:checked,reason_input:reason,request_id:rid})
async function submitted() {
  const s=await f.ready(),u=await f.upload(s.charge.id);expect(u.result.error).toBeNull()
  const rid=request(),r=await f.endpoint('receipt-submit',1,{chargeId:s.charge.id,path:u.path,requestId:rid});expect(r.status).toBe(200)
  return {...s,path:u.path,payment:await r.json(),rid}
}
describe('real receipt, financial API and concurrent transitions',()=>{
  beforeAll(async()=>{f=await paymentFixture()},30000);afterAll(async()=>{await f?.cleanup()})
  it('validates actual upload completion before submission; upload alone is unpaid, retry is one payment',async()=>{
    const s=await f.ready(),missing=`${f.actors[1].uid}/${s.charge.id}/${request()}.pdf`
    expect((await f.actors[1].client.rpc('submit_payment',{charge_id_input:s.charge.id,receipt_path_input:missing,request_id:request()})).error?.message).toBe('RECEIPT_NOT_READY')
    const u=await f.upload(s.charge.id);expect(u.result.error).toBeNull()
    expect((await f.operator.from('charges').select('status').eq('id',s.charge.id).single()).data?.status).toBe('unpaid')
    expect((await f.actors[1].client.rpc('submit_payment',{charge_id_input:s.charge.id,receipt_path_input:u.path,request_id:request()})).error?.message).toBe('RECEIPT_NOT_READY')
    const rid=request(),body={chargeId:s.charge.id,path:u.path,requestId:rid}
    const first=await f.endpoint('receipt-submit',1,body);expect(first.status).toBe(200);const p=await first.json()
    expect(await (await f.endpoint('receipt-submit',1,body)).json()).toEqual(p)
    expect((await f.operator.from('payments').select('id').eq('charge_id',s.charge.id)).data).toHaveLength(1)
  })
  it('accepts exactly 5 MiB and rejects oversize/empty/incomplete/HTML/SVG/mismatched actual bytes',async()=>{
    const s=await f.ready(),bytes=new Uint8Array(5242880).fill(32);bytes.set(receiptPdf);bytes.set(new TextEncoder().encode('%%EOF'),bytes.length-5)
    const u=await f.upload(s.charge.id,1,bytes);expect(u.result.error).toBeNull()
    const valid=await f.endpoint('receipt-submit',1,{chargeId:s.charge.id,path:u.path,requestId:request()});expect(valid.status).toBe(200)
    const other=await f.ready()
    expect((await f.upload(other.charge.id,1,new Uint8Array(5242881))).result.error).not.toBeNull()
    for(const b of [new Uint8Array(),new TextEncoder().encode('%PDF-1.4\nunfinished'),new TextEncoder().encode('<svg onload="bad"/>'),new TextEncoder().encode('<html><script>bad</script></html>'),new TextEncoder().encode('%PDF-1.4\n/JavaScript\n%%EOF')]) {
      const bad=await f.upload(other.charge.id,1,b)
      if(!bad.result.error){expect((await f.endpoint('receipt-submit',1,{chargeId:other.charge.id,path:bad.path,requestId:request()})).status).toBe(400);expect((await f.endpoint('receipt-view',0,{path:bad.path})).status).toBe(400)}
    }
    const mismatch=await f.upload(other.charge.id,1,receiptPdf,'image/png','png');expect(mismatch.result.error).toBeNull()
    expect((await f.endpoint('receipt-submit',1,{chargeId:other.charge.id,path:mismatch.path,requestId:request()})).status).toBe(400)
  })
  it('enforces own receipts, history, current membership and suspended own submission',async()=>{
    const s=await f.ready(),u=await f.upload(s.charge.id);expect(u.result.error).toBeNull()
    expect((await f.endpoint('receipt-submit',2,{chargeId:s.charge.id,path:u.path,requestId:request()})).status).toBe(403)
    expect((await f.actors[1].client.rpc('attest_receipt_upload',{object_path_input:u.path,size_bytes_input:receiptPdf.length,mime_type_input:'application/pdf',sha256_input:'a'.repeat(64)})).error?.code).toBe('42501')
    localSql(`update public.memberships set status='suspended' where user_id=${q(f.actors[1].uid)}`)
    try {
      expect((await f.endpoint('receipt-submit',1,{chargeId:s.charge.id,path:u.path,requestId:request()})).status).toBe(200)
      const history=await f.actors[1].client.rpc('get_payment_history');expect(history.error).toBeNull();expect(history.data.every((c:{participant_id:string})=>!s.pids.slice(1).includes(c.participant_id))).toBe(true)
      expect((await f.actors[1].client.from('sessions').select('id')).data).toEqual([])
    }finally{localSql(`update public.memberships set status='active' where user_id=${q(f.actors[1].uid)}`)}
    expect((await f.actors[4].client.rpc('get_payment_history')).error?.message).toBe('MEMBERSHIP_NOT_ACTIVE')
  })
  it('requires a bank check, rejects with reason and retains the rejected receipt on resubmission',async()=>{
    const s=await submitted();expect((await review(s.payment.payment_id,true,false)).error?.message).toBe('BANK_CHECK_REQUIRED')
    expect((await review(s.payment.payment_id,false,false)).error?.message).toBe('REASON_REQUIRED')
    expect((await review(s.payment.payment_id,false,false,'No bank match')).error).toBeNull()
    const u=await f.upload(s.charge.id);expect((await f.endpoint('receipt-submit',1,{chargeId:s.charge.id,path:u.path,requestId:request()})).status).toBe(200)
    const payments=await f.actors[1].client.from('payments').select('status,rejection_reason').eq('charge_id',s.charge.id)
    expect(payments.data).toEqual(expect.arrayContaining([{status:'rejected',rejection_reason:'No bank match'},{status:'submitted',rejection_reason:null}]))
  })
  it('serializes identical approval retries and different review IDs without double revenue',async()=>{
    const s=await submitted(),rid=request(),release=await holdSession(s.sid)
    const calls=[review(s.payment.payment_id,true,true,'Checked test bank',rid),review(s.payment.payment_id,true,true,'Checked test bank',rid)].map(p=>Promise.resolve(p))
    try{await financialCallsBlocked()}finally{await release()}
    const result=await Promise.all(calls);expect(result.map(r=>r.error)).toEqual([null,null]);expect(result[0].data).toEqual(result[1].data)
    expect((await review(s.payment.payment_id)).error?.message).toBe('PAYMENT_ALREADY_REVIEWED')
    expect(localSql(`select count(*) from public.audit_logs where entity_id=${q(s.payment.payment_id)} and action='payment_approved'`)).toBe('1')
    expect(localSql(`select sum(amount_sen) from public.payments where charge_id=${q(s.charge.id)} and status='approved'`)).toBe('2001')
  })
  it('serializes approval against cancellation, preserves received money and never auto-refunds',async()=>{
    const s=await submitted(),release=await holdSession(s.sid)
    const calls=[Promise.resolve(review(s.payment.payment_id)),Promise.resolve(f.actors[0].client.rpc('cancel_session',{session_id_input:s.sid,reason_input:'Court unavailable',request_id:request()}))]
    try{await financialCallsBlocked()}finally{await release()}
    const results=await Promise.all(calls);expect(results[1].error).toBeNull()
    const p=(await f.operator.from('payments').select('*').eq('id',s.payment.payment_id).single()).data!
    expect(p.status).toBe(results[0].error?'rejected':'approved');expect(p.refunded_at).toBeNull();expect(p.refund_status).toBe(p.status==='approved'?'pending':'none')
    expect((await f.operator.from('charges').select('status').eq('session_id',s.sid)).data?.every(c=>c.status==='voided'||c.status==='paid')).toBe(true)
  })
  it('records cash and explicit actual refunds with immutable original amounts',async()=>{
    const s=await f.ready(),args={charge_id_input:s.charge.id,reason_input:'Received full cash',request_id:request()}
    const cash=await f.actors[0].client.rpc('record_cash_payment',args);expect(cash.error).toBeNull();expect((await f.actors[0].client.rpc('record_cash_payment',args)).data).toEqual(cash.data)
    expect((await f.operator.from('payments').update({amount_sen:1}).eq('id',cash.data.payment_id)).error?.code).toBe('42501')
    expect((await f.actors[0].client.rpc('cancel_session',{session_id_input:s.sid,reason_input:'Cancelled after play',request_id:request()})).error).toBeNull()
    const refundArgs={payment_id_input:cash.data.payment_id,reason_input:'Full cash returned, test reference',request_id:request()}
    const refund=await f.actors[0].client.rpc('record_payment_refund',refundArgs);expect(refund.error).toBeNull();expect((await f.actors[0].client.rpc('record_payment_refund',refundArgs)).data).toEqual(refund.data)
    expect((await f.operator.from('payments').select('amount_sen,status,refund_status').eq('id',cash.data.payment_id).single()).data).toEqual({amount_sen:2001,status:'approved',refund_status:'refunded'})
  })
  it('explicit fee adjustment preserves paid history and marks full refund pending, stale financial tokens fail',async()=>{
    const s=await submitted(),admin=f.actors[0].client
    await admin.rpc('save_fee_draft',{session_id_input:s.sid,full_fee_sen_input:2500,court_cost_sen_input:0,shuttle_quantity_input:0,shuttle_cost_sen_input:0,notes_input:'Revised cost',request_id:request()})
    const before=await admin.rpc('get_fee_preview',{session_id_input:s.sid});expect((await review(s.payment.payment_id)).error).toBeNull()
    const adjust=(token:string,ack=true)=>admin.rpc('adjust_session_fee',{session_id_input:s.sid,full_fee_sen_input:2500,review_token_input:token,reason_input:'Corrected court cost',refund_ack_input:ack,request_id:request()})
    expect((await adjust(before.data.review_token)).error?.message).toBe('FEE_PREVIEW_STALE')
    const next=await admin.rpc('get_fee_preview',{session_id_input:s.sid});expect((await adjust(next.data.review_token,false)).error?.message).toBe('REFUND_ACK_REQUIRED');expect((await adjust(next.data.review_token)).error).toBeNull()
    expect((await f.operator.from('payments').select('amount_sen,status,refund_status').eq('id',s.payment.payment_id).single()).data).toEqual({amount_sen:2001,status:'approved',refund_status:'pending'})
    expect((await f.operator.from('charges').select('amount_sen,status,is_current').eq('participant_id',s.pids[0])).data).toEqual(expect.arrayContaining([{amount_sen:2001,status:'paid',is_current:false},{amount_sen:2500,status:'unpaid',is_current:true}]))
  })
  it('serializes a real receipt submission against full cash recording',async()=>{
    const s=await f.ready(),u=await f.upload(s.charge.id);expect(u.result.error).toBeNull()
    const release=await holdSession(s.sid)
    const transfer=f.endpoint('receipt-submit',1,{chargeId:s.charge.id,path:u.path,requestId:request()})
    const cash=Promise.resolve(f.actors[0].client.rpc('record_cash_payment',{charge_id_input:s.charge.id,reason_input:'Full cash received',request_id:request()}))
    try{await financialCallsBlocked()}finally{await release()}
    const [receiptResult,cashResult]=await Promise.all([transfer,cash])
    expect(Number(receiptResult.ok)+Number(!cashResult.error)).toBe(1)
    const payments=await f.operator.from('payments').select('status,amount_sen,method').eq('charge_id',s.charge.id)
    expect(payments.data).toHaveLength(1);expect(payments.data![0].amount_sen).toBe(2001)
    expect(payments.data![0].status).toBe(receiptResult.ok?'submitted':'approved')
  })
  it('serializes opposite review decisions, so only one audited result wins',async()=>{
    const s=await submitted(),release=await holdSession(s.sid)
    const calls=[review(s.payment.payment_id,true,true,'Bank matched'),review(s.payment.payment_id,false,false,'Bank not matched')].map(r=>Promise.resolve(r))
    try{await financialCallsBlocked()}finally{await release()}
    const results=await Promise.all(calls)
    expect(results.filter(r=>!r.error)).toHaveLength(1);expect(results.find(r=>r.error)?.error?.message).toBe('PAYMENT_ALREADY_REVIEWED')
    expect(localSql(`select count(*) from public.audit_logs where entity_id=${q(s.payment.payment_id)} and action in ('payment_approved','payment_rejected')`)).toBe('1')
  })
  it('serves only the configured private PNG/JPEG payment QR to authorized members',async()=>{
    const previous=await f.operator.from('club_settings').select('*').maybeSingle();expect(previous.error).toBeNull()
    const path=`${request()}.png`,png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0,73,69,78,68,174,66,96,130])
    expect((await f.operator.storage.from('payment-qr').upload(path,png,{contentType:'image/png'})).error).toBeNull()
    try {
      expect((await f.operator.from('club_settings').upsert({id:true,bank_name:'Synthetic Test Bank',bank_account_name:'Synthetic Club',bank_account_number:'0000000000',qr_object_path:path})).error).toBeNull()
      expect((await f.actors[1].client.storage.from('payment-qr').download(path)).error).not.toBeNull()
      const view=await f.endpoint('receipt-view',1,{kind:'payment-qr'});expect(view.status).toBe(200)
      const result=await view.json();expect(result.expiresIn).toBe(60);expect(new URL(result.url).origin).toBe(process.env.SUPABASE_TEST_URL)
      expect(new Uint8Array(await (await fetch(result.url)).arrayBuffer())).toEqual(png)
      expect((await f.endpoint('receipt-view',4,{kind:'payment-qr'})).status).toBe(403)
    }finally{
      expect((await f.operator.storage.from('payment-qr').remove([path])).error).toBeNull()
      if(previous.data)expect((await f.operator.from('club_settings').upsert(previous.data)).error).toBeNull()
      else expect((await f.operator.from('club_settings').delete().eq('id',true)).error).toBeNull()
    }
  })
})

import { randomUUID } from 'node:crypto'
import { billingFixture } from './billing-fixture'
import { localSql,sqlLiteral as q } from './local-sql'
export const receiptPdf=new TextEncoder().encode('%PDF-1.4\nSynthetic payment receipt only\n%%EOF')
export async function paymentFixture() {
  const f=await billingFixture(),objects:string[]=[]
  async function ready() {
    const s=await f.session(),admin=f.actors[0].client
    for(const pid of s.pids.slice(0,2))if((await admin.rpc('set_attendance',{participant_id_input:pid,attendance_input:'present',reason_input:'',request_id:randomUUID()})).error)throw new Error('Synthetic payment attendance failed')
    if((await admin.rpc('save_fee_draft',{session_id_input:s.sid,full_fee_sen_input:2001,court_cost_sen_input:0,shuttle_quantity_input:0,shuttle_cost_sen_input:0,notes_input:'Synthetic payment fee',request_id:randomUUID()})).error)throw new Error('Synthetic payment draft failed')
    const preview=await admin.rpc('get_fee_preview',{session_id_input:s.sid})
    if((await admin.rpc('publish_session_fee',{session_id_input:s.sid,full_fee_sen_input:2001,review_token_input:preview.data.review_token,reason_input:'',request_id:randomUUID()})).error)throw new Error('Synthetic payment publication failed')
    const charges=await f.operator.from('charges').select('*').eq('session_id',s.sid)
    if(charges.error)throw new Error('Synthetic charge read failed')
    return {...s,charges:charges.data,charge:charges.data.find(c=>c.participant_id===s.pids[0])!}
  }
  async function upload(chargeId:string,actor=1,bytes=receiptPdf,mime='application/pdf',extension='pdf') {
    const path=`${f.actors[actor].uid}/${chargeId}/${randomUUID()}.${extension}`;objects.push(path)
    const result=await f.actors[actor].client.storage.from('receipts').upload(path,bytes,{contentType:mime})
    return {path,result}
  }
  async function endpoint(kind:'receipt-submit'|'receipt-view',actor:number,body:object) {
    const session=await f.actors[actor].client.auth.getSession()
    return fetch(`${process.env.SUPABASE_TEST_URL}/functions/v1/${kind}`,{method:'POST',headers:{apikey:process.env.SUPABASE_TEST_PUBLISHABLE_KEY!,Authorization:`Bearer ${session.data.session!.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(body)})
  }
  async function cleanup() {
    // Find test-owned orphan uploads too, if submission failed after Storage
    // completed. Read metadata only; delete actual objects through Storage API.
    const owners=f.actors.map(a=>q(a.uid)).join(',')
    const stored=JSON.parse(localSql(`select coalesce(jsonb_agg(name),'[]') from storage.objects where bucket_id='receipts' and owner_id in (${owners});`)) as string[]
    for(const path of stored)if(!objects.includes(path))objects.push(path)
    if(objects.length&&(await f.operator.storage.from('receipts').remove(objects)).error)throw new Error('Synthetic receipt cleanup failed')
    localSql(`delete from app_private.receipt_checks where owner_id in (${owners});`)
    await f.cleanup()
  }
  return {...f,ready,upload,endpoint,cleanup,objects}
}

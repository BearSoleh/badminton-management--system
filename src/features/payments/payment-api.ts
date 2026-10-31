import { connection,fail } from '../sessions/api'
import type { Database } from '../../types/database'

export type Payment=Database['public']['Tables']['payments']['Row']
export type ChargeHistory=Database['public']['Tables']['charges']['Row']&{session_title:string;starts_at:string;session_status:string;fee_version:number;display_name:string;payments:Payment[]}
export async function getPaymentHistory():Promise<ChargeHistory[]> {
  const {data,error,status}=await connection().rpc('get_payment_history')
  if(error||!Array.isArray(data))fail(error,status)
  return data as unknown as ChargeHistory[]
}
export async function getBankDetails() {
  const {data,error,status}=await connection().from('club_settings').select('bank_name,bank_account_name,bank_account_number,qr_object_path').maybeSingle()
  if(error)fail(error,status)
  return data
}
async function edge(name:string,body:object) {
  const {data,error}=await connection().functions.invoke(name,{body})
  if(error) {
    let code=''
    if(error.context instanceof Response)try{code=(await error.context.json()).error}catch{/* Provider details are never shown. */}
    fail({message:code})
  }
  return data
}
export async function submitReceipt(chargeId:string,path:string,requestId:string) {return edge('receipt-submit',{chargeId,path,requestId})}
export async function getReceiptLink(path:string):Promise<string> {return (await edge('receipt-view',{path})).url}
export async function getQrLink():Promise<string> {return (await edge('receipt-view',{kind:'payment-qr'})).url}
export async function reviewPayment(id:string,approve:boolean,checked:boolean,reason:string,request:string) {
  const {error,status}=await connection().rpc('review_payment',{payment_id_input:id,approve_input:approve,bank_checked_input:checked,reason_input:reason,request_id:request});if(error)fail(error,status)
}
export async function recordCash(id:string,reason:string,request:string) {
  const {error,status}=await connection().rpc('record_cash_payment',{charge_id_input:id,reason_input:reason,request_id:request});if(error)fail(error,status)
}
export async function recordRefund(id:string,reason:string,request:string) {
  const {error,status}=await connection().rpc('record_payment_refund',{payment_id_input:id,reason_input:reason,request_id:request});if(error)fail(error,status)
}
export async function cancelSession(id:string,reason:string,request:string) {
  const {error,status}=await connection().rpc('cancel_session',{session_id_input:id,reason_input:reason,request_id:request});if(error)fail(error,status)
}

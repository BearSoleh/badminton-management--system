import { connection,fail } from '../sessions/api'
import type { ClubSession } from '../sessions/api'
import type { Database } from '../../types/database'

export type FeeRow={participant_id:string;display_name:string;participation_status:string;attendance:string;confirmed_at:string|null;percent:number;amount_sen:number|null}
export type FeePreview={session:ClubSession;server_now:string;costs:Database['public']['Tables']['session_costs']['Row']|null;rows:FeeRow[];latest_version:number;unmarked_count:number;review_token:string}
export type FeeDraft=Omit<Database['public']['Functions']['save_fee_draft']['Args'],'session_id_input'|'request_id'>
export async function getFeePreview(id:string):Promise<FeePreview> {
  const {data,error,status}=await connection().rpc('get_fee_preview',{session_id_input:id})
  if(error||!data)fail(error,status)
  const result=data as unknown as FeePreview
  if(!result.session||!Array.isArray(result.rows)||typeof result.review_token!=='string')fail(null)
  return result
}
export async function setAttendance(id:string,attendance:string,reason:string,request:string) {
  const {error,status}=await connection().rpc('set_attendance',{participant_id_input:id,attendance_input:attendance,reason_input:reason,request_id:request})
  if(error)fail(error,status)
}
export async function saveFeeDraft(id:string,draft:FeeDraft,request:string) {
  const {error,status}=await connection().rpc('save_fee_draft',{session_id_input:id,...draft,request_id:request})
  if(error)fail(error,status)
}
export async function publishFee(preview:FeePreview,reason:string,request:string) {
  const {data,error,status}=await connection().rpc('publish_session_fee',{session_id_input:preview.session.id,full_fee_sen_input:preview.costs!.full_fee_sen!,review_token_input:preview.review_token,reason_input:reason,request_id:request})
  if(error||!data)fail(error,status)
  return data as {version:number}
}
export async function getOwnFee(id:string,participantId:string|null) {
  const charge=participantId?await connection().from('charges').select('amount_sen,percent,status,fee_version_id').eq('participant_id',participantId).eq('session_id',id).eq('is_current',true).maybeSingle():null
  if(charge?.error)fail(charge.error,charge.status)
  let query=connection().from('fee_versions').select('id,full_fee_sen,version').eq('session_id',id)
  // Fetch the immutable version attached to this snapshot, even if another
  // publication commits between the two RLS-protected HTTP reads.
  if(charge?.data)query=query.eq('id',charge.data.fee_version_id)
  const version=await query.order('version',{ascending:false}).limit(1).maybeSingle()
  if(version.error)fail(version.error,version.status)
  return {version:version.data,charge:charge?.data??null}
}

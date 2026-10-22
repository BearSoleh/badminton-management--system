import { connection,fail } from '../sessions/api'
import type { WaitlistOffer } from '../sessions/api'

export type ActiveOffer={session_id:string;session_title:string;offer:WaitlistOffer}
export type QueueEntry={participant_id:string;display_name:string;participation_status:string;queue_joined_at:string;eligible:boolean;offer:WaitlistOffer|null}
export async function getActiveOffers():Promise<{server_now:string;offers:ActiveOffer[]}> {
  const {data,error,status}=await connection().rpc('get_active_offers')
  if(error||!data)fail(error,status)
  return data as unknown as {server_now:string;offers:ActiveOffer[]}
}
export async function respondToOffer(id:string,accept:boolean,request:string):Promise<{offer_state:string}> {
  const {data,error,status}=await connection().rpc('respond_to_offer',{offer_id_input:id,accept_input:accept,request_id:request})
  if(error||!data)fail(error,status)
  return data as {offer_state:string}
}
export async function getQueue(id:string):Promise<{server_now:string;queue:QueueEntry[]}> {
  const {data,error,status}=await connection().rpc('get_waitlist_queue',{session_id_input:id})
  if(error||!data)fail(error,status)
  return data as unknown as {server_now:string;queue:QueueEntry[]}
}
export async function setMode(id:string,mode:string,reason:string,request:string) {
  const {error,status}=await connection().rpc('set_waitlist_mode',{session_id_input:id,mode_input:mode,reason_input:reason,request_id:request})
  if(error)fail(error,status)
}
export async function offerSlot(id:string,reason:string,request:string) {
  const {error,status}=await connection().rpc('admin_offer_slot',{participant_id_input:id,reason_input:reason,request_id:request})
  if(error)fail(error,status)
}
export async function confirmLateSlot(id:string,consent:boolean,reason:string,request:string) {
  const {error,status}=await connection().rpc('admin_confirm_late_slot',{participant_id_input:id,consent_input:consent,reason_input:reason,request_id:request})
  if(error)fail(error,status)
}

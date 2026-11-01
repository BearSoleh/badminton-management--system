import { supabase } from '../../lib/supabase'
import type { Database } from '../../types/database'

// Capability state intentionally has no storage adapter or persistence.
let guestSession:string|null=null
export const forgetGuest=()=>{guestSession=null}
export function takePrivateFragment():string|null {
  const token=new URLSearchParams(location.hash.slice(1)).get('token')
  if(location.hash)history.replaceState(null,'',location.pathname+location.search)
  return token&&/^[A-Za-z0-9_-]{43}$/.test(token)?token:null
}
const errors:Record<string,string>={GUEST_ACCOUNT_REQUIRED:'Two guest places are already used or reserved. Create an account and ask an admin to verify and link it before joining another session.',ADMIN_VERIFICATION_REQUIRED:'This guest already exists. Ask an admin to verify their identity and reissue access.',CHARGE_NOT_PAYABLE:'This charge is no longer payable. Refresh to see its current status.',REQUEST_ID_CONFLICT:'This request changed. Refresh and try again.',INVALID_RECEIPT:'Choose a complete JPEG, PNG or PDF bank receipt, up to 5 MiB.',SESSION_NOT_JOINABLE:'This session is no longer open for changes.',OFFER_NOT_PENDING:'This offer is no longer available. Refresh the session.'}
export async function capabilityCall<T>(name:'guest-access'|'account-recovery',body:object):Promise<T> {
  if(!supabase)throw new Error('The club connection is unavailable. Try again later.')
  const result=await supabase.functions.invoke(name,{body,headers:guestSession&&name==='guest-access'?{'X-BJBC-Guest':guestSession}:{}})
  if(result.error) {
    let code='';try{code=(await result.error.context?.json())?.error??''}catch{/* Never surface request/provider diagnostics. */}
    throw new Error(errors[code]??(name==='account-recovery'?'Recovery is unavailable. Contact your club admin for a new verified reset link.':'Private access is unavailable. Ask your club admin to verify and reissue your invitation.'))
  }
  return result.data as T
}
export async function openGuest(token:string) {const result=await capabilityCall<{session:string;expires_at:string}>('guest-access',{action:'exchange',token});guestSession=result.session;return result.expires_at}
type Row<K extends keyof Database['public']['Tables']>=Database['public']['Tables'][K]['Row']
export type GuestCharge=Row<'charges'>&{fee_version:number;payments:Row<'payments'>[]}
export type GuestSnapshot={guest:{id:string;name:string;uses_reserved_or_counted:number};session:Pick<Row<'sessions'>,'id'|'title'|'venue'|'starts_at'|'ends_at'|'operational_status'|'billing_status'>;server_now:string;participation:Row<'participants'>|null;offer:Row<'waitlist_offers'>|null;withdrawal_percent:number;charges:GuestCharge[];bank:{bank_name:string|null;bank_account_name:string|null;bank_account_number:string|null;has_qr:boolean}|null}
export const guestSnapshot=()=>capabilityCall<GuestSnapshot>('guest-access',{action:'snapshot'})
export type GuestManagement={guests:(Row<'guests'>&{uses_reserved_or_counted:number;invitations:{id:string;session_id:string;expires_at:string;revoked_at:string|null;exchanged:boolean}[]})[];members:{id:string;display_name:string;phone:string;status:string}[]}
export async function guestManagement():Promise<GuestManagement> {if(!supabase)throw new Error('Club connection unavailable.');const r=await supabase.rpc('get_guest_management');if(r.error)throw new Error('Guest management is unavailable. Refresh your account and try again.');return r.data as unknown as GuestManagement}
export async function guestReceipt(chargeId:string,file:File,requestId:string) {
  if(file.size<1||file.size>5242880||!['application/pdf','image/jpeg','image/png'].includes(file.type))throw new Error(errors.INVALID_RECEIPT)
  const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384))
  return capabilityCall('guest-access',{action:'submit',chargeId,requestId,file:btoa(binary),mime:file.type,extension:file.type==='application/pdf'?'pdf':file.type==='image/png'?'png':'jpg'})
}

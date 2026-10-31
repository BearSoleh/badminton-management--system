import { supabase } from '../../lib/supabase'
import type { Database } from '../../types/database'

export type ClubSession = Database['public']['Tables']['sessions']['Row']
export type Participant = Database['public']['Tables']['participants']['Row']
export type RosterEntry = Database['public']['Functions']['get_session_roster']['Returns'][number]
export type WaitlistOffer = Database['public']['Tables']['waitlist_offers']['Row']
export type Snapshot = { session: ClubSession; server_now: string; participation: Participant|null; offer:WaitlistOffer|null; vote:'play'|'pass'|null; roster:RosterEntry[]; counts:{confirmed:number;held:number;waiting:number}; can_vote:boolean;can_join:boolean;can_withdraw:boolean;withdrawal_percent:number }
export class MembershipChanged extends Error {}
const messages: Record<string,string> = {
  MEMBERSHIP_NOT_ACTIVE:'Your membership changed. Please check your account status.',
  ADMIN_REQUIRED:'Admin access is required. Refresh your account and try again.',
  VOTING_CLOSED:'Voting has closed. Refresh the session to see the available actions.',
  VOTING_STILL_OPEN:'Voting is still open. Choose Play to request a place.',
  SESSION_STARTED:'This session has started. Contact an admin for changes.',
  SESSION_NOT_JOINABLE:'This session is no longer accepting participation changes.',
  SESSION_NOT_FOUND:'This session is unavailable or you do not have access.',
  PARTICIPANT_NOT_FOUND:'This participation is unavailable. Refresh the session.',
  INVALID_SESSION:'Check the session details. Start and voting close must be in the future; end must follow start.',
  DRAFT_REQUIRED:'Only draft sessions can be edited or published.',
  REQUEST_ID_CONFLICT:'These details changed during a retry. Reload before trying again.',
  OFFER_NOT_FOUND:'This offer is unavailable or belongs to another player. Refresh the session.',
  OFFER_NOT_PENDING:'This offer has already ended or been answered. Refresh the session for its current state.',
  NO_VACANCY:'All places are confirmed or held. Refresh the queue before trying again.',
  OFFER_WINDOW_CLOSED:'There are fewer than 15 minutes before start. Record player consent to confirm a late vacancy.',
  PLAYER_NOT_WAITING:'This player is no longer eligible for an offer. Refresh the queue.',
  REASON_REQUIRED:'Enter a reason for this admin action.',
  CONSENT_REQUIRED:'Confirm that the player explicitly agreed to take this place.',
  USE_TIMED_OFFER:'Use a 15-minute offer while the full confirmation window is available.',
  NOTIFICATION_NOT_FOUND:'This notification is unavailable. Refresh your inbox.',
  ATTENDANCE_NOT_ELIGIBLE:'Only confirmed players can be marked attended or no-show.',
  ATTENDANCE_NOT_OPEN:'Attendance opens at session start and is unavailable for cancelled sessions.',
  INVALID_ATTENDANCE:'Choose Attended or No-show for a confirmed player.',
  ATTENDANCE_UNMARKED:'Review every unmarked confirmed player before publishing fees.',
  FEE_PUBLICATION_NOT_OPEN:'Fees can be set after the session ends. Cancelled sessions have no charge.',
  FEE_NOT_SET:'Enter and review the full per-player fee first.',
  INVALID_FEE:'Enter valid nonnegative fee and cost amounts in sen.',
  FEE_PREVIEW_STALE:'The session or fees changed. Refresh, then review the charges again before publishing.',
  PAYMENT_ADJUSTMENT_REQUIRED:'These fees have payment records and need a payment adjustment. They cannot be replaced here.',
  INVALID_REASON:'Keep the correction reason within 2,000 characters.',
}
export function fail(error: {message:string}|null, status?:number): never {
  if (error?.message === 'MEMBERSHIP_NOT_ACTIVE' || error?.message === 'ADMIN_REQUIRED' || status===401) throw new MembershipChanged(messages[error?.message??'']??'Your session has ended. Please log in again.')
  throw new Error(messages[error?.message??'']??'We couldn’t complete that request. Check your connection and try again.')
}
export function connection() { if(!supabase) throw new Error('Club connection is not configured.'); return supabase }
export async function listSessions() {
  const {data,error,status}=await connection().from('sessions').select('*').order('starts_at',{ascending:true})
  if(error||!data) fail(error,status)
  return data
}
export async function getSnapshot(id:string):Promise<Snapshot> {
  const {data,error,status}=await connection().rpc('get_session_snapshot',{session_id_input:id})
  if(error||!data) fail(error,status)
  const result=data as unknown as Snapshot
  if(!result.session || !Array.isArray(result.roster) || typeof result.server_now!=='string') fail(null)
  return result
}
export async function castVote(id:string,choice:'play'|'pass',request:string) {
  const {error,status}=await connection().rpc('cast_session_vote',{session_id_input:id,choice_input:choice,request_id:request}); if(error) fail(error,status)
}
export async function joinSession(id:string,request:string) {
  const {error,status}=await connection().rpc('join_session',{session_id_input:id,request_id:request}); if(error) fail(error,status)
}
export async function withdrawParticipation(id:string,request:string) {
  const {error,status}=await connection().rpc('withdraw_participation',{participant_id_input:id,request_id:request}); if(error) fail(error,status)
}
export async function publishSession(id:string,request:string) {
  const {error,status}=await connection().rpc('publish_session',{session_id_input:id,request_id:request}); if(error) fail(error,status)
}
export type SessionDraft = Omit<Database['public']['Functions']['save_session']['Args'],'request_id'|'session_id_input'>
export async function saveSession(id:string|null,draft:SessionDraft,request:string):Promise<string> {
  // PostgreSQL allows NULL to mean a new draft; official UUID argument types
  // are generated as string even though function arguments permit SQL NULL.
  const {data,error,status}=await connection().rpc('save_session',{...draft,session_id_input:id as string,request_id:request})
  if(error||!data) fail(error,status)
  const result=data as {session_id?:string}
  if(typeof result.session_id!=='string') fail(null)
  return result.session_id
}

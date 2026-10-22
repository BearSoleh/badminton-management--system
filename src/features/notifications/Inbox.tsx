import { useCallback,useEffect,useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell,RefreshCw } from 'lucide-react'
import { useResource } from '../../lib/use-resource'
import { formatKlTime } from '../../lib/time'
import { listNotifications,markRead } from './api'
import type { Notification } from './api'
import { MembershipChanged } from '../sessions/api'
import { useAuth } from '../auth/auth-context'

const descriptions:Record<string,{title:string;body:string}>={
  waitlist_offer:{title:'A place is available',body:'Open the session to check the time remaining and choose Continue or Decline.'},
  waitlist_offer_accepted:{title:'Your place is confirmed',body:'You accepted a slot offer. Open the session for current details.'},
  waitlist_offer_declined:{title:'Offer declined',body:'You declined this offer. No new charge applies.'},
  waitlist_offer_expired:{title:'Offer expired',body:'The confirmation window ended. No new charge applies.'},
  waitlist_offer_revoked:{title:'Offer withdrawn',body:'The session is no longer accepting this offer. Open it for current details.'},
  waitlist_job_failure:{title:'Waiting list needs admin attention',body:'The backend could not process this session. Review the queue and scheduler health.'},
}
function content(n:Notification) {
  const payload=n.payload&&typeof n.payload==='object'&&!Array.isArray(n.payload)?n.payload:{}
  return {description:descriptions[n.type]??{title:'Club update',body:'Open the session for the latest details.'},title:typeof payload.session_title==='string'?payload.session_title:null,
    sessionId:typeof payload.session_id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(payload.session_id)?payload.session_id:null}
}
export function Inbox() {
  const auth=useAuth(),loader=useCallback(()=>listNotifications(),[])
  const {data,error,reload}=useResource('inbox',loader)
  const [busy,setBusy]=useState<string|null>(null),[actionError,setActionError]=useState<string|null>(null)
  useEffect(()=>{
    const refresh=()=>{if(document.visibilityState==='visible')void reload()}
    window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh)
    return()=>{window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh)}
  },[reload])
  async function read(id:string) {
    if(busy)return
    setBusy(id);setActionError(null)
    try{await markRead(id);await reload()}catch(e){setActionError(e instanceof Error?e.message:'Unable to mark as read. Try again.');if(e instanceof MembershipChanged)await auth.refresh()}finally{setBusy(null)}
  }
  return <><div className="page-heading"><div><h1>Notifications</h1><p>Updates from your club, saved here in the app.</p></div><button className="button text" onClick={()=>void reload()}><RefreshCw size={17}/>Refresh inbox</button></div>
    <p className="inbox-explainer">In-app only. These messages cannot alert you while the site is closed. An offer message may be out of date; the session always shows its current state.</p>
    {actionError&&<p role="alert" className="notice error">{actionError}</p>}
    {error?<div role="alert" className="session-error"><p>{error}</p><button className="button text" onClick={()=>void reload()}>Try again</button></div>:!data?<p role="status">Loading notifications…</p>:!data.length?<div className="sessions-empty"><Bell size={30} aria-hidden="true"/><h2>You’re all caught up</h2><p>Slot offers and club updates will appear here.</p></div>:<><p className="inbox-summary">{data.filter(n=>!n.read_at).length} unread · Latest {data.length} {data.length===1?'message':'messages'}</p><ul className="inbox-list">{data.map(n=>{
      const {description,title,sessionId}=content(n)
      return <li key={n.id} className={n.read_at?'is-read':'is-unread'}><div className="inbox-item-top"><h2>{description.title}</h2>{!n.read_at&&<span className="unread-label">Unread</span>}</div>{title&&<p className="inbox-session-title">{title}</p>}<p>{description.body}</p><time dateTime={n.created_at}>{formatKlTime(n.created_at)} KL</time><div className="inbox-item-actions">{sessionId&&<Link className="button text" to={n.type==='waitlist_job_failure'?`/admin/sessions/${sessionId}`:`/app/sessions/${sessionId}`}>View session</Link>}{!n.read_at&&<button className="button text" disabled={Boolean(busy)} onClick={()=>void read(n.id)}>{busy===n.id?'Saving…':'Mark as read'}</button>}</div></li>
    })}</ul></>}
  </>
}

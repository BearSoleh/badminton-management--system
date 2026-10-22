import { useCallback,useId,useRef,useState } from 'react'
import { useAuth } from '../auth/auth-context'
import type { ClubSession } from '../sessions/api'
import { MembershipChanged } from '../sessions/api'
import { useResource } from '../../lib/use-resource'
import { confirmLateSlot,getQueue,offerSlot,setMode } from './api'
import { formatKlTime } from '../../lib/time'

export function AdminQueue({session,serverNow,onChange}:{session:ClubSession;serverNow:string;onChange:()=>Promise<unknown>}) {
  const auth=useAuth(),fieldId=useId(),loader=useCallback(()=>getQueue(session.id),[session.id])
  const {data,error,reload}=useResource(session.id,loader)
  const [mode,setModeValue]=useState(session.waitlist_mode),[reason,setReason]=useState(''),[selected,setSelected]=useState(''),[consent,setConsent]=useState(false)
  const [busy,setBusy]=useState(false),[actionError,setActionError]=useState<string|null>(null)
  const intent=useRef<{key:string;id:string}|null>(null)
  const late=Date.parse(session.starts_at)-Date.parse(serverNow)<900000
  const open=['voting_open','joining_open'].includes(session.operational_status)&&Date.parse(serverNow)<Date.parse(session.starts_at)
  async function mutate(key:string,action:(request:string)=>Promise<unknown>) {
    if(busy)return
    if(intent.current?.key!==key)intent.current={key,id:crypto.randomUUID()}
    setBusy(true);setActionError(null)
    try{await action(intent.current.id);intent.current=null;await reload();await onChange()}
    catch(e){setActionError(e instanceof Error?e.message:'Unable to update queue. Try again.');if(e instanceof MembershipChanged)await auth.refresh();await reload()}
    finally{setBusy(false)}
  }
  return <section className="admin-queue" aria-label="Waiting-list controls"><div className="section-heading"><h2>Waiting-list controls</h2><button className="button text" disabled={busy} onClick={()=>void reload()}>Refresh queue</button></div><p>Earlier requests lead the queue. A manual offer holds a place for 15 minutes; choosing a later player is recorded as an override.</p>
    {error?<div role="alert" className="session-error"><p>{error}</p><button className="button text" onClick={()=>void reload()}>Try queue again</button></div>:!data?<p role="status">Loading queue…</p>:data.queue.length===0?<p className="queue-empty">No players are waiting.</p>:<ol className="queue-list">{data.queue.map(row=><li key={row.participant_id}><label><input type="radio" name={`${fieldId}-player`} disabled={busy||!open||!row.eligible||row.participation_status!=='waitlisted'} checked={selected===row.participant_id} onChange={()=>{setSelected(row.participant_id);setConsent(false)}}/><span><strong>{row.display_name}</strong><span>{row.participation_status==='offered'?'Awaiting confirmation':row.eligible?'Waiting':'Not currently eligible'}{row.offer&&` · Ends ${formatKlTime(row.offer.expires_at)} KL`}</span></span></label></li>)}</ol>}
    {actionError&&<p role="alert" className="notice error">{actionError}</p>}
    {open&&<div className="queue-form"><div className="field"><label htmlFor={`${fieldId}-mode`}>Promotion mode</label><select id={`${fieldId}-mode`} value={mode} disabled={busy} onChange={e=>setModeValue(e.target.value)}><option value="automatic">Automatic</option><option value="manual">Manual</option></select></div><div className="field"><label htmlFor={`${fieldId}-reason`}>Reason for admin action</label><textarea id={`${fieldId}-reason`} value={reason} maxLength={2000} disabled={busy} onChange={e=>setReason(e.target.value)} placeholder="Explain the mode change or player selection"/></div><button className="button secondary" disabled={busy||!reason.trim()||mode===session.waitlist_mode} onClick={()=>void mutate(`mode:${mode}:${reason}`,r=>setMode(session.id,mode,reason,r))}>Save promotion mode</button>
      {late&&<label className="consent-field"><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/><span>The selected player explicitly agreed to take this place. Record how they agreed in the reason.</span></label>}
      <button className="button primary" disabled={busy||!selected||!reason.trim()||(late&&!consent)} onClick={()=>void mutate(`offer:${selected}:${reason}:${consent}`,r=>late?confirmLateSlot(selected,consent,reason,r):offerSlot(selected,reason,r))}>{busy?'Saving…':late?'Confirm late place with consent':'Offer selected player'}</button>
      <p className="session-footnote">{late?'Fewer than 15 minutes remain before start. A late place requires recorded player consent.':'Existing offers stay held when you switch to manual mode. Automatic mode fills vacancies in timestamp order.'}</p></div>}
  </section>
}

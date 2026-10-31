import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, CalendarDays, MapPin, RefreshCw, Users } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/auth-context'
import { formatKlTime } from '../../lib/time'
import { useResource } from '../../lib/use-resource'
import { OfferCard } from '../waitlist/OfferCard'
import { ActiveOffers } from '../waitlist/ActiveOffers'
import { AdminQueue } from '../waitlist/AdminQueue'
import { CancelSession } from '../payments/CancelSession'
import { PublishedFee } from '../payments/PublishedFee'
import { castVote, getSnapshot, joinSession, listSessions, MembershipChanged, publishSession, withdrawParticipation } from './api'
import type { ClubSession, Snapshot } from './api'

const participationLabels:Record<string,string>={confirmed:'Confirmed',waitlisted:'Waiting list',offered:'Awaiting confirmation',withdrawn_early:'Withdrawn early',late_cancelled:'Late cancelled',offer_declined:'Offer declined',offer_expired:'Offer expired'}
function sessionLabel(s:ClubSession,now:number) {
  if(s.operational_status==='draft') return 'Draft'
  if(s.operational_status==='cancelled') return 'Cancelled'
  if(s.operational_status==='completed'||new Date(s.ends_at).getTime()<=now) return 'Session ended'
  if(new Date(s.starts_at).getTime()<=now) return 'In progress'
  return new Date(s.voting_closes_at).getTime()>now?'Voting open':'Joining open'
}
export function SessionsHome({admin=false}:{admin?:boolean}) {
  const {membership}=useAuth()
  const loader=useCallback(()=>listSessions(),[])
  const {data,error,reload}=useResource('sessions',loader)
  const [history,setHistory]=useState(false)
  const [now,setNow]=useState(()=>Date.now())
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(timer)},[])
  const items=data?.filter(s=>admin || (s.operational_status!=='draft' && ((s.operational_status==='completed'||s.operational_status==='cancelled'||Date.parse(s.ends_at)<=now)===history)))
  if(history) items?.reverse()
  return <>
    <div className="page-heading"><div><h1>{admin?'Manage sessions':`Welcome back, ${membership?.display_name}.`}</h1><p>{admin?'Prepare a session, then open voting for your club.':'Make room for your next game.'}</p></div>{admin?<Link className="button primary" to="/admin/sessions/new">New session<ArrowRight size={17}/></Link>:<Link className="button text" to="/app/profile">Your profile<ArrowRight size={17}/></Link>}</div>
    {!admin&&<ActiveOffers/>}
    <section className="session-index" aria-label={admin?'Club sessions':'Sessions'}><div className="section-heading"><h2>{admin?'Club sessions':'Sessions'}</h2>{!admin&&<div className="session-filters" role="group" aria-label="Show sessions"><button aria-pressed={!history} onClick={()=>setHistory(false)}>Upcoming</button><button aria-pressed={history} onClick={()=>setHistory(true)}>History</button></div>}</div>
      {error?<div className="session-error" role="alert"><p>{error}</p><button className="button text" onClick={reload}>Try again<RefreshCw size={16}/></button></div>:!items?<p role="status" className="loading-state">Loading sessions…</p>:items.length===0?<div className="sessions-empty"><CalendarDays size={32} aria-hidden="true"/><h3>{history?'No past sessions yet.':'No sessions yet.'}</h3><p>{admin?'Create your first draft when the court details are ready.':history?'Your club’s completed and cancelled sessions will appear here.':'Your next game will appear here when an admin opens voting.'}</p></div>:<div className="session-list">{items.map(s=><article className="session-row" key={s.id}><div className="session-date" aria-hidden="true"><span>{new Intl.DateTimeFormat('en-GB',{day:'2-digit',timeZone:'Asia/Kuala_Lumpur'}).format(new Date(s.starts_at))}</span>{new Intl.DateTimeFormat('en-GB',{month:'short',timeZone:'Asia/Kuala_Lumpur'}).format(new Date(s.starts_at))}</div><div className="session-row-main"><span className={`session-state state-${s.operational_status}`}>{sessionLabel(s,now)}</span><h3><Link to={admin?`/admin/sessions/${s.id}`:`/app/sessions/${s.id}`}>{s.title}</Link></h3><p>{formatKlTime(s.starts_at)} <span className="kl-label">KL</span></p><p className="session-venue"><MapPin size={14} aria-hidden="true"/>{s.venue}</p></div><div className="session-row-end"><span><Users size={15} aria-hidden="true"/>{s.capacity} places</span><span>{s.billing_status==='not_published'?'Fee not yet set':'Fee published'}</span><ArrowRight size={20} aria-hidden="true"/></div></article>)}</div>}
    </section><p className="session-footnote">All session times use Asia/Kuala_Lumpur. Earlier Play votes get priority.</p>
  </>
}

export function SessionDetail({admin=false}:{admin?:boolean}) {
  const {id=''}=useParams(),auth=useAuth()
  const loader=useCallback(()=>getSnapshot(id),[id])
  const {data,error,reload}=useResource<Snapshot>(id,loader)
  const [busy,setBusy]=useState(false),[actionError,setActionError]=useState<string|null>(null),[message,setMessage]=useState<string|null>(null)
  const [confirmation,setConfirmation]=useState<'withdraw'|'pass'|null>(null)
  const intent=useRef<{key:string;id:string}|null>(null)
  const expiryRefreshes=useRef(new Set<string>())
  const offerId=data?.offer?.id
  const expireRefresh=useCallback(()=>{if(offerId&&!expiryRefreshes.current.has(offerId)){expiryRefreshes.current.add(offerId);void reload()}},[offerId,reload])
  useEffect(()=>{
    const refresh=()=>{if(document.visibilityState==='visible')void reload()}
    window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh)
    return()=>{window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh)}
  },[reload])
  async function mutate(key:string,action:(request:string)=>Promise<void>) {
    if(busy) return
    if(intent.current?.key!==key) intent.current={key,id:crypto.randomUUID()}
    setBusy(true);setActionError(null);setMessage(null)
    try {await action(intent.current.id);intent.current=null;setConfirmation(null);setMessage('Your changes have been saved.');await reload()}
    catch(cause){setActionError(cause instanceof Error?cause.message:'Unable to save. Please try again.');if(cause instanceof MembershipChanged)await auth.refresh();await reload()}
    finally{setBusy(false)}
  }
  const s=data?.session,p=data?.participation
  const isParticipant=p&&['confirmed','waitlisted','offered'].includes(p.participation_status)
  return <>
    <Link className="back-link" to={admin?'/admin/sessions':'/app'}>Back to {admin?'manage sessions':'your club'}</Link>
    {error?<div className="session-error" role="alert"><h1>Session unavailable</h1><p>{error}</p><button className="button text" onClick={reload}>Try again</button></div>:!s||!data?<p role="status">Loading session…</p>:<>
      <div className="page-heading session-detail-heading"><div><h1>{s.title}</h1><p className="session-venue"><MapPin size={17} aria-hidden="true"/>{s.venue}</p></div><span className={`session-state state-${s.operational_status}`}>{sessionLabel(s,Date.parse(data.server_now))}</span></div>
      <dl className="session-facts"><div><dt>Starts</dt><dd>{formatKlTime(s.starts_at)}</dd></div><div><dt>Ends</dt><dd>{formatKlTime(s.ends_at)}</dd></div><div><dt>Voting closes</dt><dd>{formatKlTime(s.voting_closes_at)}</dd></div><div><dt>Capacity</dt><dd>{s.capacity} {s.capacity===1?'player':'players'}</dd></div></dl><p className="session-footnote">All times are in Kuala Lumpur (MYT, UTC+8).</p>
      {actionError&&<p role="alert" className="notice error">{actionError}</p>}{message&&<p role="status" className="save-feedback">{message}</p>}
      {admin&&s.operational_status==='draft'&&<section className="draft-actions"><div><h2>Ready to invite the club?</h2><p>This draft is only visible to admins. Publishing opens voting.</p></div><Link className="button text" to={`/admin/sessions/${s.id}/edit`}>Edit draft</Link><button className="button primary" disabled={busy} onClick={()=>void mutate(`publish:${s.id}`,r=>publishSession(s.id,r))}>{busy?'Publishing…':'Publish voting'}<ArrowRight size={17}/></button></section>}
      {admin&&s.operational_status!=='cancelled'&&<CancelSession id={s.id} onChange={reload}/>}
      <div className="session-detail-grid">
        <section className="participation-panel" aria-label="Your participation"><h2>Your participation</h2><p className="own-participation-state">{p?participationLabels[p.participation_status]:data.vote==='pass'?'Not playing':'Choose your availability'}</p>
          {p?.participation_status==='waitlisted'&&<p>You’re in the queue. A place is confirmed only after you accept a slot offer.</p>}
          {p?.participation_status==='offered'&&data.offer&&<OfferCard key={`${data.offer.id}:${data.server_now}`} offer={data.offer} serverNow={data.server_now} onChange={reload} onExpire={expireRefresh}/>}
          {p?.participation_status==='offered'&&!data.offer&&<p>This offer has ended. Refresh for the latest queue state.</p>}
          {s.operational_status!=='cancelled'&&(p?.liability_percent??0)>0&&<p className="retained-liability">Your existing {p!.liability_percent}% cancellation obligation remains.</p>}
          {s.operational_status!=='draft'&&data.can_vote&&p?.participation_status!=='offered'&&<div className="vote-buttons" role="group" aria-label="Your vote"><button className="button primary" disabled={busy} aria-pressed={data.vote==='play'&&Boolean(isParticipant)} onClick={()=>void mutate(`play:${s.id}`,r=>castVote(s.id,'play',r))}>Play<ArrowRight size={17}/></button><button className="button secondary" disabled={busy} aria-pressed={data.vote==='pass'} onClick={()=>isParticipant?setConfirmation('pass'):void mutate(`pass:${s.id}`,r=>castVote(s.id,'pass',r))}>Not playing</button></div>}
          {data.can_join&&!isParticipant&&<button className="button primary w-full" disabled={busy} onClick={()=>void mutate(`join:${s.id}`,r=>joinSession(s.id,r))}>{p?'Rejoin session':'Join session'}<ArrowRight size={17}/></button>}
          {data.can_withdraw&&p?.participation_status!=='offered'&&!confirmation&&<button className="button text w-full" disabled={busy} onClick={()=>setConfirmation('withdraw')}>{p?.participation_status==='confirmed'?'Withdraw':'Leave waiting list'}</button>}
          {confirmation&&<div className="withdraw-confirmation" role="group" aria-label="Confirm withdrawal"><h3>Confirm your withdrawal</h3><p>{data.withdrawal_percent}% of the full session fee applies. {s.billing_status==='not_published'?'The amount will be determined after the session.':''}</p><p>Before the session’s KL calendar day: 0%. On the day, confirmed withdrawals: 75%. The rate applies when your withdrawal is processed.</p><div><button className="button primary" disabled={busy} onClick={()=>void mutate(`${confirmation}:${s.id}`,r=>confirmation==='pass'?castVote(s.id,'pass',r):withdrawParticipation(p!.id,r))}>{busy?'Saving…':'Confirm withdrawal'}</button><button className="button text" disabled={busy} onClick={()=>setConfirmation(null)}>Keep my place</button></div></div>}
          {!data.can_vote&&!data.can_join&&!data.can_withdraw&&s.operational_status!=='draft'&&<p>Participation changes are closed. Contact a club admin if you need help.</p>}
          <div className="session-fee"><span>Session fee</span>{s.operational_status==='cancelled'?<><strong>No charge — session cancelled.</strong><Link className="back-link" to="/app/payments">View payment and refund history</Link></>:s.billing_status==='not_published'?<><strong>Fee not yet set</strong><p>The admin sets the full per-player fee manually after play.</p></>:<PublishedFee key={`${s.id}:${s.updated_at}`} sessionId={s.id} participantId={p?.id??null}/>}</div>
          <button className="button text refresh-session" disabled={busy} onClick={()=>{setConfirmation(null);reload()}}><RefreshCw size={15}/>Refresh session</button>
        </section>
        <section className="roster-panel" aria-label="Player list"><div className="section-heading"><h2>Player list</h2><span>{data.counts.confirmed+data.counts.held} / {s.capacity} places</span></div><p className="roster-summary">{data.counts.confirmed} confirmed · {data.counts.held} awaiting confirmation · {data.counts.waiting} waiting</p>{data.roster.length===0?<p className="roster-empty">No players yet. Play votes will appear here.</p>:<ul className="roster-list">{data.roster.map(row=><li key={row.participant_id}><span>{row.display_name}</span><span className={`participation-badge participation-${row.participation_status}`}>{participationLabels[row.participation_status]??row.participation_status}</span></li>)}</ul>}<p className="session-footnote">Earlier Play votes get priority. If you withdraw and rejoin, you return to the end of the queue.</p></section>
      </div>
      {admin&&s.operational_status!=='draft'&&<AdminQueue key={`${s.id}:${data.server_now}`} session={s} serverNow={data.server_now} onChange={reload}/>}
      {admin&&s.operational_status!=='draft'&&<section className="draft-actions"><div><h2>Attendance & fees</h2><p>Review confirmed players, set the full fee manually, then preview and publish charges.</p></div><Link className="button primary" to={`/admin/sessions/${s.id}/attendance`}>Manage attendance & fees<ArrowRight size={17}/></Link></section>}
    </>}
  </>
}

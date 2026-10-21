import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getSnapshot, MembershipChanged, saveSession } from './api'
import type { ClubSession, SessionDraft } from './api'
import { klInputToIso, toKlInput } from '../../lib/time'
import { useAuth } from '../auth/auth-context'

export function SessionEditor() {
  const {id}=useParams(),navigate=useNavigate(),auth=useAuth()
  const [record,setRecord]=useState<ClubSession|null>(null),[loadError,setLoadError]=useState<string|null>(null)
  useEffect(()=>{if(!id)return;let active=true;getSnapshot(id).then(s=>{if(active)setRecord(s.session)}).catch(e=>{if(active)setLoadError(e instanceof Error?e.message:'Unable to load this draft.')});return()=>{active=false}},[id])
  if(loadError) return <div role="alert"><p>{loadError}</p><Link to="/admin/sessions">Back to sessions</Link></div>
  if(id&&record?.id!==id) return <p role="status">Loading draft…</p>
  if(record&&record.operational_status!=='draft') return <><h1>This session is published.</h1><p>Published details cannot be edited here.</p><Link to={`/admin/sessions/${id}`}>Back to session</Link></>
  return <SessionForm key={id??'new'} record={record} onSave={async(draft,request)=>{try{const saved=await saveSession(id??null,draft,request);navigate(`/admin/sessions/${saved}`,{replace:true})}catch(cause){if(cause instanceof MembershipChanged)await auth.refresh();throw cause}}}/>
}
function SessionForm({record,onSave}:{record:ClubSession|null;onSave:(draft:SessionDraft,request:string)=>Promise<void>}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
  const intent=useRef<{payload:string;id:string}|null>(null)
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(busy)return
    const data=new FormData(event.currentTarget)
    setBusy(true);setError(null)
    try {
      const draft:SessionDraft={title_input:String(data.get('title')).trim(),venue_input:String(data.get('venue')).trim(),starts_at_input:klInputToIso(String(data.get('start'))),ends_at_input:klInputToIso(String(data.get('end'))),voting_closes_at_input:klInputToIso(String(data.get('close'))),capacity_input:Number(data.get('capacity')),waitlist_mode_input:String(data.get('mode'))}
      const payload=JSON.stringify(draft)
      if(intent.current?.payload!==payload)intent.current={payload,id:crypto.randomUUID()}
      await onSave(draft,intent.current.id)
    } catch(cause){setError(cause instanceof Error?cause.message:'Unable to save this draft. Please try again.')} finally{setBusy(false)}
  }
  return <div className="session-editor"><Link className="back-link" to={record?`/admin/sessions/${record.id}`:'/admin/sessions'}>Back to sessions</Link><div className="page-heading"><div><h1>{record?'Edit draft':'New session'}</h1><p>Set the court details. Publish when you’re ready for votes.</p></div></div><form className="auth-form session-form" onSubmit={submit} aria-busy={busy}>
    <div className="field"><label htmlFor="session-title">Session title</label><input id="session-title" name="title" required maxLength={120} defaultValue={record?.title}/></div>
    <div className="field"><label htmlFor="session-venue">Venue</label><input id="session-venue" name="venue" required maxLength={300} defaultValue={record?.venue}/></div>
    <div className="session-form-pair"><div className="field"><label htmlFor="session-start">Starts at (KL)</label><input id="session-start" name="start" type="datetime-local" required defaultValue={record?toKlInput(record.starts_at):undefined}/></div><div className="field"><label htmlFor="session-end">Ends at (KL)</label><input id="session-end" name="end" type="datetime-local" required defaultValue={record?toKlInput(record.ends_at):undefined}/></div></div>
    <div className="field"><label htmlFor="session-close">Voting closes at (KL)</label><input id="session-close" name="close" type="datetime-local" required defaultValue={record?toKlInput(record.voting_closes_at):undefined}/><p className="field-hint">All dates use Kuala Lumpur time (UTC+8), even if your device is elsewhere. Voting must close before or at the session start.</p></div>
    <div className="session-form-pair"><div className="field"><label htmlFor="session-capacity">Player capacity</label><input id="session-capacity" name="capacity" type="number" inputMode="numeric" min={1} step={1} required defaultValue={record?.capacity}/></div><div className="field"><label htmlFor="session-mode">Waiting-list mode</label><select id="session-mode" name="mode" defaultValue={record?.waitlist_mode??'automatic'}><option value="automatic">Automatic</option><option value="manual">Admin managed</option></select></div></div>
    <p className="field-hint">No fee is entered here. Set the full per-player fee manually after the session.</p>{error&&<p className="notice error" role="alert">{error}</p>}<button className="button primary" disabled={busy}>{busy?'Saving…':'Save draft'}<ArrowRight size={18}/></button>
  </form></div>
}

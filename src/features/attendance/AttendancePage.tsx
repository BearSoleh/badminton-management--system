import { useCallback,useRef,useState } from 'react'
import { Link,useParams } from 'react-router-dom'
import { useAuth } from '../auth/auth-context'
import { useResource } from '../../lib/use-resource'
import { formatKlTime } from '../../lib/time'
import { MembershipChanged } from '../sessions/api'
import { getFeePreview,setAttendance } from '../payments/api'
import type { FeeRow } from '../payments/api'
import { FeeEditor } from '../payments/FeeEditor'

function AttendanceRow({row,disabled,onMark}:{row:FeeRow;disabled:boolean;onMark:(row:FeeRow,state:string,reason:string)=>Promise<void>}) {
  const [reason,setReason]=useState('')
  return <li className="attendance-row"><div><strong>{row.display_name}</strong><span>{row.attendance==='unmarked'?'Needs review':row.attendance==='present'?'Attended':'Confirmed no-show'}</span></div><div className="attendance-controls"><label className="field"><span>Attendance for {row.display_name}</span><select aria-label={`Attendance for ${row.display_name}`} value={row.attendance} disabled={disabled} onChange={e=>void onMark(row,e.target.value,reason)}><option value="unmarked" disabled>Choose attendance</option><option value="present">Attended</option><option value="no_show">No-show</option></select></label>{row.attendance!=='unmarked'&&<label className="field"><span>Correction reason for {row.display_name}</span><input value={reason} maxLength={2000} disabled={disabled} onChange={e=>setReason(e.target.value)} placeholder="Required when changing attendance"/></label>}</div></li>
}
export function AttendancePage() {
  const {id=''}=useParams(),auth=useAuth()
  const loader=useCallback(()=>getFeePreview(id),[id])
  const {data,error,reload}=useResource(id,loader)
  const [busy,setBusy]=useState(false),[actionError,setActionError]=useState<string|null>(null),[message,setMessage]=useState<string|null>(null)
  const intent=useRef<{key:string;id:string}|null>(null)
  async function mark(row:FeeRow,state:string,reason:string) {
    if(busy)return
    const key=JSON.stringify([row.participant_id,state,reason])
    if(intent.current?.key!==key)intent.current={key,id:crypto.randomUUID()}
    setBusy(true);setActionError(null);setMessage(null)
    try{await setAttendance(row.participant_id,state,reason,intent.current.id);intent.current=null;await reload()}
    catch(e){setActionError(e instanceof Error?e.message:'Unable to save attendance.');if(e instanceof MembershipChanged)await auth.refresh()}
    finally{setBusy(false)}
  }
  if(error)return <div role="alert"><h1>Attendance unavailable</h1><p>{error}</p><button className="button text" onClick={reload}>Try again</button></div>
  if(!data)return <p role="status">Loading attendance and fees…</p>
  const eligible=data.rows.filter(r=>r.participation_status==='confirmed'&&r.confirmed_at)
  const attendanceOpen=!['draft','cancelled'].includes(data.session.operational_status)&&Date.parse(data.server_now)>=Date.parse(data.session.starts_at)
  return <><Link className="back-link" to={`/admin/sessions/${id}`}>Back to session</Link><div className="page-heading"><div><h1>Attendance & fees</h1><p>{data.session.title} · {formatKlTime(data.session.starts_at)} KL</p></div><button className="button text" disabled={busy} onClick={()=>{setMessage(null);void reload()}}>Refresh attendance & fees</button></div>
    {actionError&&<p role="alert" className="notice error">{actionError}</p>}{message&&<p role="status" className="save-feedback">{message}</p>}
    <section className="attendance-section" aria-label="Attendance review"><div className="section-heading"><h2>Review attendance</h2><span>{data.unmarked_count} unmarked</span></div><p>Mark every confirmed player before publishing. Attended and confirmed no-show players are charged 100%.</p>{!attendanceOpen&&<p>Attendance opens at session start. Cancelled sessions cannot be marked or billed.</p>}{eligible.length?<ul className="attendance-list">{eligible.map(row=><AttendanceRow key={row.participant_id} row={row} disabled={busy||!attendanceOpen} onMark={mark}/>)}</ul>:<p>No eligible confirmed players.</p>}</section>
    <FeeEditor key={id} data={data} locked={busy} onReload={reload} onPublished={version=>setMessage(`Published fee version ${version}.`)}/>
  </>
}

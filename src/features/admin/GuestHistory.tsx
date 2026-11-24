import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useResource } from '../../lib/use-resource'
import { connection } from '../sessions/api'
import { adminError } from './api'
import { formatKlTime } from '../../lib/time'
import { formatMoney } from '../../lib/money'
import type { Database } from '../../types/database'
type History={participations:(Database['public']['Tables']['participants']['Row']&{session_title:string;starts_at:string;operational_status:string;charges:(Database['public']['Tables']['charges']['Row']&{payments:Database['public']['Tables']['payments']['Row'][]})[]})[]}
export function GuestHistory({guestId}:{guestId:string}){
  const loader=useCallback(async()=>{const r=await connection().rpc('get_guest_history',{guest_id_input:guestId});if(r.error)adminError(r.error);return r.data as unknown as History},[guestId]),{data,error,reload}=useResource(`guest-history:${guestId}`,loader)
  return <section className="guest-history"><h3>Original participation and payment history</h3>{error?<p role="alert">{error}<button className="button text" onClick={reload}>Refresh history</button></p>:!data?<p role="status">Loading guest history…</p>:data.participations.length?<ul className="payment-records">{data.participations.map(p=><li className="payment-record" key={p.id}><h4><Link to={`/admin/sessions/${p.session_id}`}>{p.session_title}</Link></h4><p>{formatKlTime(p.starts_at)} (KL) · {p.participation_status.replaceAll('_',' ')} · {p.attendance.replaceAll('_',' ')}</p><p className="field-hint">Original queue time: {formatKlTime(p.queue_joined_at)} (KL){p.confirmed_at&&<> · Confirmed {formatKlTime(p.confirmed_at)} (KL)</>}{p.withdrawn_at&&<> · Withdrawn {formatKlTime(p.withdrawn_at)} (KL)</>}</p>{p.merged_into_id&&<p>Retired duplicate participation. Original records and financial history are retained.</p>}{p.charges.length?p.charges.map(c=><div key={c.id}><p><strong>{formatMoney(c.amount_sen)}</strong> · {c.status.replaceAll('_',' ')}{!c.is_current?' · Earlier charge':''}</p>{c.payments.map(py=><p key={py.id}>{formatMoney(py.amount_sen)} · {py.method} · {py.status} · Refund: {py.refund_status}{py.refunded_at&&<> · {formatKlTime(py.refunded_at)} (KL)</>}</p>)}</div>):<p>No published charge for this participation.</p>}</li>)}</ul>:<p>No participation history yet.</p>}<Link className="back-link" to="/admin/payments">Review receipts and financial history</Link></section>
}

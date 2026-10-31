import { useRef,useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../auth/auth-context'
import { MembershipChanged } from '../sessions/api'
import { parseSen,formatMoney } from '../../lib/money'
import { adjustFee,getFeePreview,publishFee,saveFeeDraft } from './api'
import type { FeePreview,FeeDraft } from './api'

export function FeeEditor({data,locked,onReload,onPublished}:{data:FeePreview;locked:boolean;onReload:()=>Promise<FeePreview|undefined>;onPublished:(version:number)=>void}) {
  const auth=useAuth(),costs=data.costs
  const [fields,setFields]=useState({fee:costs?.full_fee_sen==null?'':(costs.full_fee_sen/100).toFixed(2),court:((costs?.court_cost_sen??0)/100).toFixed(2),quantity:String(costs?.shuttle_quantity??0),shuttle:((costs?.shuttle_cost_sen??0)/100).toFixed(2),notes:costs?.notes??'',reason:''})
  const [preview,setPreview]=useState<{data:FeePreview;key:string}|null>(null),[reviewed,setReviewed]=useState(false),[refundAck,setRefundAck]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
  const intent=useRef<{key:string;id:string}|null>(null)
  const formKey=JSON.stringify(fields)
  const current=preview?.key===formKey&&preview.data.review_token===data.review_token?preview.data:null
  const linked=(current?.financial_payments??[]).filter(p=>['submitted','approved'].includes(p.status))
  const pending=linked.some(p=>p.status==='submitted')
  const received=linked.filter(p=>p.status==='approved'&&p.refund_status==='none')
  const adjustment=linked.length>0
  const disabled=busy||locked
  const open=!['draft','cancelled'].includes(data.session.operational_status)&&Date.parse(data.server_now)>=Date.parse(data.session.ends_at)
  function edit(name:keyof typeof fields,value:string) {setFields(v=>({...v,[name]:value}));setReviewed(false);setRefundAck(false);setPreview(null);setError(null)}
  function request(key:string) {if(intent.current?.key!==key)intent.current={key,id:crypto.randomUUID()};return intent.current.id}
  async function failure(e:unknown) {setError(e instanceof Error?e.message:'Unable to save. Please try again.');if(e instanceof MembershipChanged)await auth.refresh()}
  async function review(e:FormEvent) {
    e.preventDefault();if(disabled)return
    const fee=parseSen(fields.fee),court=parseSen(fields.court),shuttle=parseSen(fields.shuttle),quantity=Number(fields.quantity)
    if(fee===null||court===null||shuttle===null||!/^\d+$/.test(fields.quantity)||!Number.isInteger(quantity)||quantity>2147483647){setError('Enter nonnegative amounts with up to two decimal places and a whole shuttle quantity.');return}
    const draft:FeeDraft={full_fee_sen_input:fee,court_cost_sen_input:court,shuttle_quantity_input:quantity,shuttle_cost_sen_input:shuttle,notes_input:fields.notes}
    setBusy(true);setError(null);setPreview(null);setReviewed(false)
    try {await saveFeeDraft(data.session.id,draft,request(`draft:${JSON.stringify(draft)}`));intent.current=null;const next=await getFeePreview(data.session.id);await onReload();setPreview({data:next,key:formKey})}
    catch(e){await failure(e)}finally{setBusy(false)}
  }
  async function publish() {
    if(disabled||!current||!reviewed||pending||(adjustment&&!refundAck))return
    setBusy(true);setError(null)
    try{const result=adjustment?await adjustFee(current,fields.reason,refundAck,request(`adjust:${current.review_token}:${fields.reason}:${refundAck}`)):await publishFee(current,fields.reason,request(`publish:${current.review_token}:${fields.reason}`));intent.current=null;setPreview(null);setReviewed(false);await onReload();onPublished(result.version)}
    catch(e){await failure(e)}finally{setBusy(false)}
  }
  return <section className="fee-editor" aria-label="Manual session fee"><div className="section-heading"><h2>Set the full session fee</h2><span>{data.latest_version?`Published version ${data.latest_version}`:'Fee not yet set'}</span></div><p>Enter the full per-player fee you determined after play. Court and shuttle costs are notes for your review; they are never divided automatically.</p>{!open&&<p>Fee entry opens after the session ends. Cancelled sessions have no charge.</p>}
    <form className="fee-form" onSubmit={review}><fieldset disabled={disabled||!open}><div className="session-form-pair"><label className="field"><span>Full per-player fee (RM)</span><input inputMode="decimal" required value={fields.fee} onChange={e=>edit('fee',e.target.value)}/><small>Enter 0.00 only when the full fee is intentionally zero.</small></label><label className="field"><span>Court cost (RM)</span><input inputMode="decimal" required value={fields.court} onChange={e=>edit('court',e.target.value)}/></label><label className="field"><span>Shuttles used</span><input inputMode="numeric" required value={fields.quantity} onChange={e=>edit('quantity',e.target.value)}/></label><label className="field"><span>Shuttle cost (RM)</span><input inputMode="decimal" required value={fields.shuttle} onChange={e=>edit('shuttle',e.target.value)}/></label></div><label className="field"><span>Cost notes</span><textarea maxLength={2000} value={fields.notes} onChange={e=>edit('notes',e.target.value)}/></label>{data.latest_version>0&&<label className="field"><span>Fee correction reason</span><textarea required maxLength={2000} value={fields.reason} onChange={e=>edit('reason',e.target.value)}/><small>A new version preserves earlier fee and charge snapshots. Paid fees require an explicit full manual refund and replacement charge. Review pending receipts first.</small></label>}<p className="session-footnote">Early withdrawals, remaining waitlist and declined/expired offers have no charge, unless a prior confirmed late-cancellation obligation remains. Confirmed session-day withdrawals: 75%, rounded half-up to the nearest sen. Cancelled session: no charge.</p>{data.unmarked_count>0&&<p className="notice">Review all {data.unmarked_count} unmarked confirmed players above before continuing.</p>}<button className="button primary" disabled={data.unmarked_count>0} type="submit">{busy?'Saving…':'Review charges'}</button></fieldset></form>
    {error&&<p role="alert" className="notice error">{error}</p>}
    {current&&<section className="charge-preview" aria-label="Charge preview"><h3>Charge preview</h3><p>Full fee: <strong>{formatMoney(current.costs!.full_fee_sen!)}</strong>. Review every player before publishing version {current.latest_version+1}.</p><ul className="charge-preview-list">{current.rows.map(row=><li key={row.participant_id}><div><strong>{row.display_name}</strong><span>{row.participation_status==='confirmed'?(row.attendance==='present'?'Attended':'Confirmed no-show'):row.percent===75?'Confirmed late cancellation':'No charge'}</span></div><span>{row.percent}%</span><b>{row.amount_sen==null?'Needs review':formatMoney(row.amount_sen)}</b></li>)}</ul>{current.rows.length===0&&<p>No participants. This version will contain no charges.</p>}<label className="consent-field"><input type="checkbox" checked={reviewed} disabled={disabled} onChange={e=>setReviewed(e.target.checked)}/>I reviewed every participant’s charge.</label>{adjustment&&<div className="adjustment-warning"><h3>Payment adjustment</h3>{pending?<p>Review every pending receipt in Verify payments before changing fees.</p>:<><p>Received payments stay on the earlier charge version. Return these full amounts manually, then collect the replacement full charges. No credit, partial payment or automatic refund is created.</p><ul>{received.map(p=><li key={p.payment_id}>{formatMoney(p.amount_sen)} · full manual refund pending</li>)}</ul><label className="consent-field"><input type="checkbox" checked={refundAck} disabled={disabled} onChange={e=>setRefundAck(e.target.checked)}/>I will return the full received payments manually and collect the replacement full charges.</label></>}</div>}<button className="button primary" disabled={disabled||!reviewed||current.unmarked_count>0||pending||(adjustment&&!refundAck)} onClick={()=>void publish()}>{busy?'Publishing…':adjustment?'Publish fee adjustment':'Publish fees'}</button><p className="session-footnote">Publication creates immutable fee and charge snapshots. Corrections require a reason and another version.</p></section>}
  </section>
}

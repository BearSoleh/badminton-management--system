import { useEffect,useRef,useState } from 'react'
import { Clock3 } from 'lucide-react'
import { useAuth } from '../auth/auth-context'
import { MembershipChanged } from '../sessions/api'
import type { WaitlistOffer } from '../sessions/api'
import { respondToOffer } from './api'
import { formatKlTime } from '../../lib/time'

export function OfferCard({offer,serverNow,onChange,onExpire}:{offer:WaitlistOffer;serverNow:string;onChange:()=>Promise<unknown>;onExpire:()=>void}) {
  const auth=useAuth()
  const [anchor]=useState(()=>performance.now()),[elapsed,setElapsed]=useState(0)
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null)
  const intent=useRef<{accept:boolean;request:string}|null>(null),notified=useRef(false)
  const remaining=Math.max(0,Math.ceil((Date.parse(offer.expires_at)-Date.parse(serverNow)-elapsed)/1000))
  useEffect(()=>{const timer=setInterval(()=>setElapsed(performance.now()-anchor),250);return()=>clearInterval(timer)},[anchor])
  useEffect(()=>{if(remaining===0&&!notified.current){notified.current=true;onExpire()}},[remaining,onExpire])
  async function respond(accept:boolean) {
    if(busy||remaining===0)return
    if(intent.current?.accept!==accept)intent.current={accept,request:crypto.randomUUID()}
    setBusy(true);setError(null)
    try {
      const r=await respondToOffer(offer.id,accept,intent.current.request)
      intent.current=null
      if(r.offer_state==='expired'||r.offer_state==='revoked')setNotice('This offer has ended. Your place was not confirmed.')
      await onChange()
    }catch(e){setError(e instanceof Error?e.message:'Unable to respond. Try again.');if(e instanceof MembershipChanged)await auth.refresh()}
    finally{setBusy(false)}
  }
  return <div className="offer-content">
    <h3>{remaining>0?'A place is available':'Offer window ended'}</h3>
    <p>{remaining>0?'Continue to confirm your place, or decline so the next player can play.':'Checking the latest session state. Refresh if it has not updated yet.'}</p>
    <div className="offer-timer"><Clock3 size={19} aria-hidden="true"/><span aria-label="Time remaining">{String(Math.floor(remaining/60)).padStart(2,'0')}:{String(remaining%60).padStart(2,'0')}</span><span>remaining</span></div>
    <p className="offer-deadline">Ends {formatKlTime(offer.expires_at)} KL. The server checks the exact deadline.</p>
    {error&&<p role="alert" className="notice error">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <div className="offer-actions"><button className="button primary" disabled={busy||remaining===0} onClick={()=>void respond(true)}>{busy?'Saving…':'Continue'}</button><button className="button secondary" disabled={busy||remaining===0} onClick={()=>void respond(false)}>Decline</button></div>
    <p className="offer-note">Declining or letting this offer expire adds no charge. Any existing cancellation obligation remains.</p>
  </div>
}

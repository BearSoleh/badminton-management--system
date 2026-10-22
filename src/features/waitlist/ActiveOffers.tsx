import { useCallback,useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useResource } from '../../lib/use-resource'
import { getActiveOffers } from './api'

export function ActiveOffers() {
  const loader=useCallback(()=>getActiveOffers(),[])
  const {data,error,reload}=useResource('active-offers',loader)
  useEffect(()=>{
    const refresh=()=>{if(document.visibilityState==='visible')void reload()}
    const timer=setInterval(refresh,30000)
    window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh)
    return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh)}
  },[reload])
  if(error)return <div className="session-error" role="alert"><p>We couldn’t check for slot offers.</p><button className="button text" onClick={()=>void reload()}>Try offers again</button></div>
  if(!data)return <p role="status" className="session-footnote">Checking for slot offers…</p>
  if(!data.offers.length)return null
  return <section className="active-offers" aria-label="Active slot offers"><h2>A place is waiting for your answer</h2><p>Offers last 15 minutes. Open the session to check the time remaining and respond.</p>{data.offers.map(item=><Link className="active-offer-link" key={item.offer.id} to={`/app/sessions/${item.session_id}`}><span>{item.session_title}</span><span>Review offer<ArrowRight size={18} aria-hidden="true"/></span></Link>)}</section>
}

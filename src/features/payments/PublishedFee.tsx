import { useCallback } from 'react'
import { useResource } from '../../lib/use-resource'
import { formatMoney } from '../../lib/money'
import { getOwnFee } from './api'

export function PublishedFee({sessionId,participantId}:{sessionId:string;participantId:string|null}) {
  const loader=useCallback(()=>getOwnFee(sessionId,participantId),[sessionId,participantId])
  const {data,error,reload}=useResource(`${sessionId}:${participantId}`,loader)
  if(error)return <div role="alert"><p>{error}</p><button className="button text" onClick={reload}>Retry fee details</button></div>
  if(!data)return <p role="status">Loading published fee…</p>
  return <><strong>{data.version?formatMoney(data.version.full_fee_sen):'Published fee unavailable'}</strong>{data.charge?<p>Your charge: <b>{formatMoney(data.charge.amount_sen)}</b> · {data.charge.percent}% · {data.charge.amount_sen===0?'No amount due':data.charge.status==='voided'?'Voided':'Published'}<br/>Fee version {data.version?.version}. Your amount is a published snapshot.</p>:<p>You have no published charge for this session.</p>}</>
}

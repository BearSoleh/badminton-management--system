import { useRef,useState } from 'react'
import { useAuth } from '../auth/auth-context'
import { MembershipChanged } from '../sessions/api'

export function usePaymentAction(onChange:()=>unknown) {
  const auth=useAuth(),intent=useRef<{key:string;id:string}|null>(null),inFlight=useRef(false)
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
  async function run(key:string,action:(request:string)=>Promise<unknown>) {
    if(inFlight.current)return
    if(intent.current?.key!==key)intent.current={key,id:crypto.randomUUID()}
    inFlight.current=true;setBusy(true);setError(null)
    try {await action(intent.current.id);intent.current=null;await onChange()}
    catch(e){setError(e instanceof Error?e.message:'Unable to save. Please try again.');if(e instanceof MembershipChanged)await auth.refresh()}
    finally{inFlight.current=false;setBusy(false)}
  }
  return {busy,error,run}
}

import { useRef,useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../auth/auth-context'
import { connection } from '../sessions/api'
import { validateReceiptBytes } from '../../../supabase/functions/_shared/receipt'
import { submitReceipt } from './payment-api'

export function ReceiptUpload({chargeId,onChange}:{chargeId:string;onChange:()=>unknown}) {
  const {membership}=useAuth(),[file,setFile]=useState<File|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false)
  const intent=useRef<{file:File;path:string;request:string;uploaded:boolean}|null>(null),inFlight=useRef(false)
  function choose(next:File|null) {
    setError(null);intent.current=null;setFile(next)
    if(next&&(!['image/jpeg','image/png','application/pdf'].includes(next.type)||next.size<1||next.size>5242880))setError('Choose a JPEG, PNG or PDF receipt, up to 5 MiB (5,242,880 bytes).')
  }
  async function submit(e:FormEvent) {
    e.preventDefault();if(inFlight.current||!file||!membership||(error&&!intent.current))return
    inFlight.current=true;setBusy(true);setError(null)
    try {
      try {validateReceiptBytes(new Uint8Array(await file.arrayBuffer()),file.name,file.type)}catch{throw new Error('Choose a complete JPEG, PNG or PDF bank receipt. HTML, SVG and active documents are not accepted.')}
      if(intent.current?.file!==file)intent.current={file,path:`${membership.user_id}/${chargeId}/${crypto.randomUUID()}.${file.type==='application/pdf'?'pdf':file.type==='image/png'?'png':'jpg'}`,request:crypto.randomUUID(),uploaded:false}
      const operation=intent.current
      if(!operation.uploaded) {
        const result=await connection().storage.from('receipts').upload(operation.path,file,{contentType:file.type,upsert:false})
        // A lost upload response may leave the immutable object already stored.
        // Submission still verifies the existing private bytes on the server.
        if(result.error&&String((result.error as {statusCode?:string}).statusCode)!=='409')throw new Error('The receipt could not be uploaded. Check your connection and try again.')
        operation.uploaded=true
      }
      await submitReceipt(chargeId,operation.path,operation.request);intent.current=null;await onChange()
    }catch(e){setError(e instanceof Error?e.message:'Unable to submit. Please try again.')}
    finally{inFlight.current=false;setBusy(false)}
  }
  return <section className="receipt-upload" aria-label="Submit receipt"><h2>Upload your transfer receipt</h2><p>Pay the full published amount in your banking app, then upload the receipt. An admin checks the bank transaction before marking it Paid.</p><form onSubmit={submit}><label className="field"><span>Receipt file</span><input type="file" accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf" disabled={busy} onChange={e=>choose(e.target.files?.[0]??null)}/><small>JPEG, PNG or PDF · maximum 5 MiB. Receipts stay private.</small></label>{error&&<p className="notice error" role="alert">{error}</p>}<button className="button primary" disabled={busy||!file}>{busy?'Checking receipt…':'Submit for verification'}</button></form></section>
}

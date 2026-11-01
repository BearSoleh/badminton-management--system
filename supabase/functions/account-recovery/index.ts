import { backend,budget,caller,digest,headers,newCapability,readBody,reply,validToken,validUuid } from '../_shared/capability.ts'

// Generic responses and no diagnostics: passwords/capabilities never enter SQL or logs.
Deno.serve(async(request:Request):Promise<Response>=>{
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers})
  if(request.method!=='POST'||new URL(request.url).search)return reply(405,{error:'RECOVERY_UNAVAILABLE'})
  try {
    if(!await budget('recovery:global',120))return reply(429,{error:'RECOVERY_UNAVAILABLE'})
    const body=await readBody(request,4096)
    if(body.action==='issue') {
      if(!validUuid(body.userId)||!validUuid(body.requestId)||typeof body.reason!=='string'||body.reason.length>2000)return reply(400,{error:'RECOVERY_UNAVAILABLE'})
      const actor=await caller(request),token=newCapability()
      const result=await actor.rpc('issue_recovery_capability',{user_id_input:body.userId,token_hash_input:await digest(token),verified_input:body.verified===true,reason_input:body.reason,request_id:body.requestId})
      return result.error?reply(403,{error:'RECOVERY_UNAVAILABLE'}):reply(200,{...result.data,token})
    }
    if(body.action!=='reset'||!validToken(body.token)||typeof body.password!=='string'||body.password.length<12||new TextEncoder().encode(body.password).length>72)return reply(400,{error:'RECOVERY_UNAVAILABLE'})
    const service=backend(),claim=await service.rpc('claim_recovery_capability',{token_hash_input:await digest(body.token)})
    if(claim.error)return reply(403,{error:'RECOVERY_UNAVAILABLE'})
    const changed=await service.auth.admin.updateUserById(claim.data.user_id,{password:body.password})
    const finished=await service.rpc('finish_recovery_capability',{recovery_id_input:claim.data.recovery_id,success_input:!changed.error})
    if(changed.error||finished.error||!finished.data)return reply(403,{error:'RECOVERY_UNAVAILABLE'})
    return reply(200,{reset:true})
  }catch{return reply(403,{error:'RECOVERY_UNAVAILABLE'})}
})

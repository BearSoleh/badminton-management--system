import { backend,budget,caller,digest,headers,newCapability,publicStorageUrl,readBody,reply,validToken,validUuid } from '../_shared/capability.ts'
import { validateReceiptBytes } from '../_shared/receipt.ts'

const safe=new Set(['GUEST_ACCOUNT_REQUIRED','SESSION_NOT_JOINABLE','OFFER_NOT_PENDING','CHARGE_NOT_PAYABLE','REQUEST_ID_CONFLICT','RECEIPT_NOT_READY','RECEIPT_ALREADY_USED','INVALID_RECEIPT','ADMIN_VERIFICATION_REQUIRED','IDENTITY_VERIFICATION_REQUIRED'])
// Never log request bodies, headers, capability hashes, paths or provider errors.
Deno.serve(async(request:Request):Promise<Response>=>{
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers})
  if(request.method!=='POST'||new URL(request.url).search)return reply(405,{error:'ACCESS_UNAVAILABLE'})
  try {
    if(!await budget('guest:global'))return reply(429,{error:'ACCESS_UNAVAILABLE'})
    const body=await readBody(request,7100000),service=backend(),op=body.action
    if(op==='invite') {
      if(!validUuid(body.sessionId)||(body.guestId!=null&&!validUuid(body.guestId))||typeof body.name!=='string'||body.name.length>80||typeof body.phone!=='string'||!/^[+][1-9][0-9]{7,14}$/.test(body.phone)||!validUuid(body.requestId))return reply(400,{error:'ACCESS_UNAVAILABLE'})
      const actor=await caller(request),token=newCapability()
      const result=await actor.rpc('issue_guest_invitation',{session_id_input:body.sessionId,guest_id_input:body.guestId??null,name_input:body.name,phone_input:body.phone,token_hash_input:await digest(token),verified_input:body.verified===true,reason_input:typeof body.reason==='string'?body.reason:'',request_id:body.requestId})
      if(result.error)return reply(403,{error:safe.has(result.error.message)?result.error.message:'ACCESS_UNAVAILABLE'})
      return reply(200,{...result.data,token})
    }
    if(op==='exchange') {
      if(!validToken(body.token))return reply(403,{error:'ACCESS_UNAVAILABLE'})
      const token=newCapability(),result=await service.rpc('exchange_guest_capability',{token_hash_input:await digest(body.token),session_hash_input:await digest(token)})
      if(result.error)return reply(403,{error:'ACCESS_UNAVAILABLE'})
      return reply(200,{...result.data,session:token})
    }
    const token=request.headers.get('X-BJBC-Guest');if(!validToken(token))return reply(403,{error:'ACCESS_UNAVAILABLE'})
    const sessionHash=await digest(token)
    if(!await budget(`guest:${sessionHash}`,120))return reply(429,{error:'ACCESS_UNAVAILABLE'})
    const rpc=(operation:string,payload:object={},requestId:unknown=null)=>service.rpc('guest_portal_action',{session_hash_input:sessionHash,operation_input:operation,payload_input:payload,request_id:requestId})
    if(op==='receipt'||op==='qr') {
      const qr=op==='qr',access=await rpc(qr?'authorize_qr':'authorize_receipt',qr?{}:{path:body.path})
      if(access.error)return reply(403,{error:'ACCESS_UNAVAILABLE'})
      const bucket=qr?'payment-qr':'receipts',path=access.data.path
      const info=await service.storage.from(bucket).info(path)
      if(info.error||!info.data||typeof info.data.size!=='number'||info.data.size<1||info.data.size>5242880||typeof info.data.contentType!=='string')return reply(400,{error:'RECEIPT_NOT_READY'})
      const file=await service.storage.from(bucket).download(path);if(file.error||!file.data)return reply(400,{error:'RECEIPT_NOT_READY'})
      const bytes=new Uint8Array(await file.data.arrayBuffer());if(bytes.length!==info.data.size)throw new Error('INVALID_RECEIPT')
      validateReceiptBytes(bytes,path,info.data.contentType)
      // Recheck after I/O; revocation cannot issue a fresh URL after authorization expires.
      if((await rpc(qr?'authorize_qr':'authorize_receipt',qr?{}:{path})).error)return reply(403,{error:'ACCESS_UNAVAILABLE'})
      const signed=await service.storage.from(bucket).createSignedUrl(path,60,qr?{}:{download:true})
      if(signed.error)return reply(403,{error:'ACCESS_UNAVAILABLE'})
      return reply(200,{url:publicStorageUrl(signed.data.signedUrl),expiresIn:60})
    }
    if(op==='submit') {
      if(!validUuid(body.chargeId)||!validUuid(body.requestId)||typeof body.file!=='string'||body.file.length>6990508||typeof body.mime!=='string'||!['pdf','jpg','jpeg','png'].includes(String(body.extension)))return reply(400,{error:'INVALID_RECEIPT'})
      // Scope supplies owner. No caller-selected Storage path or owner is accepted.
      const snap=await rpc('snapshot');if(snap.error)return reply(403,{error:'ACCESS_UNAVAILABLE'})
      const charge=snap.data.charges.find((c:{id:string})=>c.id===body.chargeId);if(!charge)return reply(403,{error:'ACCESS_UNAVAILABLE'})
      // Guest identity is derived by a scoped authorization, including during retry.
      const path=`${snap.data.guest.id}/${body.chargeId}/${body.requestId}.${body.extension}`
      let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(body.file),c=>c.charCodeAt(0))}catch{return reply(400,{error:'INVALID_RECEIPT'})}
      const mime=validateReceiptBytes(bytes,path,body.mime)
      const payload={charge_id:body.chargeId,path}
      const retry=await rpc('submit_payment',payload,body.requestId)
      if(!retry.error){
        const stored=await service.storage.from('receipts').download(path)
        if(stored.error||!stored.data||await digest(new Uint8Array(await stored.data.arrayBuffer()))!==await digest(bytes))return reply(400,{error:'REQUEST_ID_CONFLICT'})
        return reply(200,retry.data)
      }
      if(retry.error.message!=='RECEIPT_NOT_READY')return reply(400,{error:safe.has(retry.error.message)?retry.error.message:'ACCESS_UNAVAILABLE'})
      const access=await rpc('authorize_upload',{charge_id:body.chargeId});if(access.error)return reply(403,{error:'ACCESS_UNAVAILABLE'})
      const uploaded=await service.storage.from('receipts').upload(path,bytes,{contentType:mime,upsert:false})
      if(uploaded.error) {
        const old=await service.storage.from('receipts').download(path)
        if(old.error||!old.data||await digest(new Uint8Array(await old.data.arrayBuffer()))!==await digest(bytes))return reply(400,{error:'REQUEST_ID_CONFLICT'})
      }
      const checked=await service.rpc('attest_receipt_upload',{object_path_input:path,size_bytes_input:bytes.length,mime_type_input:mime,sha256_input:await digest(bytes)})
      if(checked.error)return reply(400,{error:'INVALID_RECEIPT'})
      const submitted=await rpc('submit_payment',payload,body.requestId)
      return submitted.error?reply(400,{error:safe.has(submitted.error.message)?submitted.error.message:'ACCESS_UNAVAILABLE'}):reply(200,submitted.data)
    }
    if(!['snapshot','join','withdraw','respond'].includes(String(op)))return reply(400,{error:'ACCESS_UNAVAILABLE'})
    if(op!=='snapshot'&&!validUuid(body.requestId))return reply(400,{error:'ACCESS_UNAVAILABLE'})
    const result=await rpc(String(op),op==='respond'?{accept:body.accept}:{},body.requestId)
    return result.error?reply(result.error.message==='ACCESS_UNAVAILABLE'?403:400,{error:safe.has(result.error.message)?result.error.message:'ACCESS_UNAVAILABLE'}):reply(200,result.data)
  }catch(e){return reply(e instanceof Error&&e.message==='INVALID_RECEIPT'?400:403,{error:e instanceof Error&&e.message==='INVALID_RECEIPT'?'INVALID_RECEIPT':'ACCESS_UNAVAILABLE'})}
})

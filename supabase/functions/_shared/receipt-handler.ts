import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import { validateReceiptBytes } from './receipt.ts'

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}
const reply=(status:number,body:object)=>Response.json(body,{status,headers:cors})
const safeErrors=new Set(['INVALID_RECEIPT','RECEIPT_NOT_READY','RECEIPT_ALREADY_USED','CHARGE_NOT_PAYABLE','CHARGE_ACCESS_DENIED','REQUEST_ID_CONFLICT','MEMBERSHIP_NOT_ACTIVE'])

// Never log requests, paths, tokens, signed URLs or provider diagnostics.
export function receiptHandler(mode:'view'|'submit') {
  return async(request:Request):Promise<Response>=>{
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors})
    if(request.method!=='POST')return reply(405,{error:'METHOD_NOT_ALLOWED'})
    const bearer=request.headers.get('Authorization')??''
    if(!/^Bearer \S+$/i.test(bearer))return reply(401,{error:'AUTHENTICATION_REQUIRED'})
    try {
      const apiUrl=Deno.env.get('SUPABASE_URL')!,anonKey=Deno.env.get('SUPABASE_ANON_KEY')!,secretKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      const publicUrl=new URL(Deno.env.get('BJBC_PUBLIC_SUPABASE_URL')!)
      if(publicUrl.username||publicUrl.password||publicUrl.search||publicUrl.hash||!(publicUrl.protocol==='https:'||(publicUrl.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(publicUrl.hostname))))return reply(503,{error:'RECEIPT_SERVICE_UNAVAILABLE'})
      const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}
      const caller=createClient(apiUrl,anonKey,{...options,global:{headers:{Authorization:bearer}}})
      const identity=await caller.auth.getUser(bearer.slice(7))
      if(identity.error||!identity.data.user)return reply(401,{error:'AUTHENTICATION_REQUIRED'})
      if(Number(request.headers.get('content-length')??0)>2048)return reply(400,{error:'INVALID_REQUEST'})
      const text=await request.text();if(text.length>2048)return reply(400,{error:'INVALID_REQUEST'})
      let data:{path?:unknown;chargeId?:unknown;requestId?:unknown;kind?:unknown}
      try{data=JSON.parse(text)}catch{return reply(400,{error:'INVALID_REQUEST'})}
      if(!data||typeof data!=='object')return reply(400,{error:'INVALID_REQUEST'})
      const qr=mode==='view'&&data.kind==='payment-qr'
      if(!qr&&(typeof data.path!=='string'||data.path.length>200))return reply(400,{error:'INVALID_REQUEST'})
      const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
      if(mode==='submit'&&(typeof data.chargeId!=='string'||!uuid.test(data.chargeId)||typeof data.requestId!=='string'||!uuid.test(data.requestId)))return reply(400,{error:'INVALID_REQUEST'})
      const access=qr?await caller.rpc('authorize_payment_qr'):await caller.rpc('authorize_receipt_view',{object_path_input:data.path})
      if(access.error||typeof access.data!=='string'||(!qr&&access.data!==data.path))return reply(403,{error:'RECEIPT_ACCESS_DENIED'})
      const privileged=createClient(apiUrl,secretKey,options),bucket=qr?'payment-qr':'receipts'
      const info=await privileged.storage.from(bucket).info(access.data)
      if(info.error||!info.data||typeof info.data.size!=='number'||info.data.size<1||info.data.size>5242880||typeof info.data.contentType!=='string')return reply(400,{error:'RECEIPT_NOT_READY'})
      const downloaded=await privileged.storage.from(bucket).download(access.data)
      if(downloaded.error||!downloaded.data)return reply(400,{error:'RECEIPT_NOT_READY'})
      const bytes=new Uint8Array(await downloaded.data.arrayBuffer())
      if(bytes.length!==info.data.size)return reply(400,{error:'RECEIPT_NOT_READY'})
      const mime=validateReceiptBytes(bytes,access.data,info.data.contentType)
      if(mode==='submit') {
        const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('')
        const checked=await privileged.rpc('attest_receipt_upload',{object_path_input:access.data,size_bytes_input:bytes.length,mime_type_input:mime,sha256_input:digest})
        if(checked.error)return reply(400,{error:'INVALID_RECEIPT'})
        const submitted=await caller.rpc('submit_payment',{charge_id_input:data.chargeId,receipt_path_input:access.data,request_id:data.requestId})
        if(submitted.error)return reply(400,{error:safeErrors.has(submitted.error.message)?submitted.error.message:'PAYMENT_SUBMISSION_FAILED'})
        return reply(200,submitted.data)
      }
      const signed=await privileged.storage.from(bucket).createSignedUrl(access.data,60,qr?{}:{download:true})
      if(signed.error||!signed.data?.signedUrl)return reply(403,{error:'RECEIPT_ACCESS_DENIED'})
      const output=new URL(signed.data.signedUrl);output.protocol=publicUrl.protocol;output.host=publicUrl.host
      return reply(200,{url:output.toString(),expiresIn:60})
    }catch(e){return reply(e instanceof Error&&e.message==='INVALID_RECEIPT'?400:503,{error:e instanceof Error&&e.message==='INVALID_RECEIPT'?'INVALID_RECEIPT':'RECEIPT_SERVICE_UNAVAILABLE'})}
  }
}

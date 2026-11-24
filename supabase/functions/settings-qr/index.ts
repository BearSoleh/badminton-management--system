import { backend,digest,headers,readBody,reply,validUuid } from '../_shared/capability.ts'
import { validateReceiptBytes } from '../_shared/receipt.ts'

Deno.serve(async(request:Request):Promise<Response>=>{
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers})
  if(request.method!=='POST')return reply(405,{error:'INVALID_QR'})
  try{
    const bearer=request.headers.get('Authorization')??''
    if(!/^Bearer \S+$/i.test(bearer))return reply(401,{error:'AUTHENTICATION_REQUIRED'})
    const actor=backend(bearer),identity=await actor.auth.getUser(bearer.slice(7))
    if(identity.error||!identity.data.user)return reply(401,{error:'AUTHENTICATION_REQUIRED'})
    if((await actor.rpc('get_admin_settings')).error)return reply(403,{error:'ADMIN_REQUIRED'})
    const body=await readBody(request,1024)
    if(typeof body.path!=='string'||!/^([a-f0-9-]{36})\.(jpg|jpeg|png)$/.test(body.path)||!validUuid(body.path.split('.')[0]))return reply(400,{error:'INVALID_QR'})
    const service=backend(),info=await service.storage.from('payment-qr').info(body.path)
    if(info.error||!info.data||typeof info.data.size!=='number'||info.data.size<1||info.data.size>5242880||!['image/jpeg','image/png'].includes(info.data.contentType??''))return reply(400,{error:'INVALID_QR'})
    const file=await service.storage.from('payment-qr').download(body.path)
    if(file.error||!file.data)return reply(400,{error:'INVALID_QR'})
    const bytes=new Uint8Array(await file.data.arrayBuffer());if(bytes.length!==info.data.size)return reply(400,{error:'INVALID_QR'})
    const mime=validateReceiptBytes(bytes,body.path,info.data.contentType!)
    const checked=await service.rpc('attest_payment_qr',{object_path_input:body.path,owner_id_input:identity.data.user.id,size_bytes_input:bytes.length,mime_type_input:mime,sha256_input:await digest(bytes)})
    return checked.error?reply(400,{error:'INVALID_QR'}):reply(200,{path:body.path})
  }catch{return reply(400,{error:'INVALID_QR'})}
})

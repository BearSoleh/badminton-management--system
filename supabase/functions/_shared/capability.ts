import { createClient } from 'npm:@supabase/supabase-js@2.118.0'

export const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info, x-bjbc-guest','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}
export const reply=(status:number,body:unknown)=>Response.json(body,{status,headers})
export const validToken=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v)
export const validUuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v)
export async function digest(value:string|Uint8Array):Promise<string> {
  const bytes=typeof value==='string'?new TextEncoder().encode(value):value
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource)),v=>v.toString(16).padStart(2,'0')).join('')
}
export function newCapability():string {return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')}
export function backend(bearer?:string) {
  return createClient(Deno.env.get('SUPABASE_URL')!,bearer?Deno.env.get('SUPABASE_ANON_KEY')!:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},...(bearer?{global:{headers:{Authorization:bearer}}}:{})
  })
}
export async function readBody(request:Request,max:number):Promise<Record<string,unknown>> {
  if(Number(request.headers.get('content-length')??0)>max)throw new Error('INVALID_REQUEST')
  const reader=request.body?.getReader();if(!reader)throw new Error('INVALID_REQUEST')
  let size=0;const chunks:Uint8Array[]=[]
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new Error('INVALID_REQUEST')}chunks.push(value)}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
  const data=JSON.parse(new TextDecoder().decode(bytes));if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('INVALID_REQUEST');return data
}
export async function budget(scope:string,limit=1000):Promise<boolean> {
  const r=await backend().rpc('consume_capability_budget',{bucket_input:scope,limit_input:limit});return !r.error&&r.data===true
}
export async function caller(request:Request) {
  const bearer=request.headers.get('Authorization')??''
  if(!/^Bearer \S+$/i.test(bearer))throw new Error('ACCESS_UNAVAILABLE')
  const client=backend(bearer),identity=await client.auth.getUser(bearer.slice(7))
  if(identity.error||!identity.data.user)throw new Error('ACCESS_UNAVAILABLE')
  if(!await budget(`issuer:${identity.data.user.id}`,100))throw new Error('ACCESS_UNAVAILABLE')
  return client
}
export function publicStorageUrl(input:string):string {
  const origin=new URL(Deno.env.get('BJBC_PUBLIC_SUPABASE_URL')!)
  if(origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/'||!(origin.protocol==='https:'||(origin.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(origin.hostname))))throw new Error('INVALID_CONFIGURATION')
  const url=new URL(input);url.protocol=origin.protocol;url.host=origin.host;return url.toString()
}

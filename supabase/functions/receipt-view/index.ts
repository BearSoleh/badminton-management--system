// Server only. User JWT verified by both the platform and Auth; authorization
// remains a current-database check. Never log requests, paths, tokens or URLs.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0'

const lifetime = 60
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
}
function reply(status: number, body: object) { return Response.json(body, { status, headers: cors }) }

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') return reply(405, { error: 'METHOD_NOT_ALLOWED' })
  const bearer = request.headers.get('Authorization') ?? ''
  if (!/^Bearer \S+$/i.test(bearer)) return reply(401, { error: 'AUTHENTICATION_REQUIRED' })
  try {
    const apiUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const secretKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    // Local functions use an internal Kong URL. This explicit operator setting
    // supplies the public origin; never trust Host/Origin/forwarded headers.
    const publicUrl = new URL(Deno.env.get('BJBC_PUBLIC_SUPABASE_URL')!)
    if (publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash ||
      !(publicUrl.protocol === 'https:' || (publicUrl.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(publicUrl.hostname)))) {
      return reply(503, { error: 'RECEIPT_VIEW_UNAVAILABLE' })
    }
    const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
    const caller = createClient(apiUrl, anonKey, { ...options, global: { headers: { Authorization: bearer } } })
    const identity = await caller.auth.getUser(bearer.slice(7))
    if (identity.error || !identity.data.user) return reply(401, { error: 'AUTHENTICATION_REQUIRED' })
    if (Number(request.headers.get('content-length') ?? 0) > 2048) return reply(400, { error: 'INVALID_REQUEST' })
    const text = await request.text()
    if (text.length > 2048) return reply(400, { error: 'INVALID_REQUEST' })
    let data: unknown
    try { data = JSON.parse(text) } catch { return reply(400, { error: 'INVALID_REQUEST' }) }
    if (!data || typeof data !== 'object' || !('path' in data) || typeof data.path !== 'string' || data.path.length > 200) return reply(400, { error: 'INVALID_REQUEST' })
    const access = await caller.rpc('authorize_receipt_view', { object_path_input: data.path })
    if (access.error || access.data !== data.path) return reply(403, { error: 'RECEIPT_ACCESS_DENIED' })
    const privileged = createClient(apiUrl, secretKey, options)
    const signed = await privileged.storage.from('receipts').createSignedUrl(access.data, lifetime, { download: true })
    if (signed.error || !signed.data?.signedUrl) return reply(403, { error: 'RECEIPT_ACCESS_DENIED' })
    const output = new URL(signed.data.signedUrl)
    output.protocol = publicUrl.protocol
    output.host = publicUrl.host
    return reply(200, { url: output.toString(), expiresIn: lifetime })
  } catch {
    return reply(503, { error: 'RECEIPT_VIEW_UNAVAILABLE' })
  }
})

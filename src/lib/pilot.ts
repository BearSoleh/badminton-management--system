export function pilotOrigin(input:string|undefined):string {
  try{const u=new URL(input??'');if(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.pathname==='/'&&!u.search&&!u.hash&&/^[a-z0-9]{20}\.supabase\.co$/.test(u.hostname))return u.origin}catch{/* Never echo credential-bearing configuration. */}
  throw new Error('Pilot build requires a hosted Supabase HTTPS project URL; loopback and placeholder backends cannot be published.')
}
export function pilotHeaders(origin:string):string {
  const verified=pilotOrigin(origin),socket=verified.replace('https:','wss:')
  return `/*\n  Cache-Control: no-store\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  X-Robots-Tag: noindex, nofollow\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: ${verified}; connect-src 'self' ${verified} ${socket}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'\n`
}

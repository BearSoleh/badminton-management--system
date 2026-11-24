import { describe,expect,it } from 'vitest'
import { pilotOrigin,pilotHeaders } from '../../src/lib/pilot'
describe('pilot build boundary',()=>{
  const origin=`https://${'a'.repeat(20)}.supabase.co`
  it.each([undefined,'http://127.0.0.1:54321','https://YOUR_PROJECT_REF.supabase.co',`${origin}/private`,`${origin}?token=secret`,`${origin}#token`,origin.replace('https://','https://user:pass@'),`${origin}:9999`,'https://example.com'])('rejects unsafe or local backend %s',input=>{expect(()=>pilotOrigin(input)).toThrow('Pilot build requires')})
  it('generates exact project-bound security headers without permitting arbitrary remote scripts',()=>{expect(pilotOrigin(origin)).toBe(origin);const headers=pilotHeaders(origin);expect(headers).toContain(`connect-src 'self' ${origin} wss://${'a'.repeat(20)}.supabase.co`);expect(headers).toContain("script-src 'self'");expect(headers).toContain("frame-ancestors 'none'");expect(headers).toContain('Referrer-Policy: no-referrer')})
})

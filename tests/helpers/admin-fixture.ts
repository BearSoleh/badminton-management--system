import { guestFixture } from './guest-fixture'
import { localSql,sqlLiteral as q } from './local-sql'
export const qrPng=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4x8AAAAASUVORK5CYII=','base64'))
export async function adminFixture(){
  if(localSql('select count(*) from public.club_settings')!=='0')throw new Error('Admin fixture requires empty local settings; existing settings were preserved.')
  const f=await guestFixture(),qrObjects:string[]=[]
  async function qrEndpoint(path:string,actor=0){const session=await f.actors[actor].client.auth.getSession();return fetch(`${process.env.SUPABASE_TEST_URL}/functions/v1/settings-qr`,{method:'POST',headers:{apikey:process.env.SUPABASE_TEST_PUBLISHABLE_KEY!,Authorization:`Bearer ${session.data.session!.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({path})})}
  async function cleanup(){
    const ids=f.actors.map(a=>q(a.uid)).join(',')
    const paths=JSON.parse(localSql(`select coalesce(jsonb_agg(name),'[]') from storage.objects where bucket_id='payment-qr' and owner_id in (${ids})`)) as string[]
    for(const p of paths)if(!qrObjects.includes(p))qrObjects.push(p)
    if(qrObjects.length&&(await f.operator.storage.from('payment-qr').remove(qrObjects)).error)throw new Error('Synthetic QR cleanup failed')
    localSql(`delete from app_private.payment_qr_checks where owner_id in (${ids});
      delete from public.club_settings where bank_name like 'Synthetic%' and exists(select 1 from public.audit_logs where action='club_settings_changed' and actor_user_id in (${ids}));`)
    await f.cleanup()
  }
  return {...f,qrObjects,qrEndpoint,cleanup}
}

import { randomUUID,createHash } from 'node:crypto'
import { spawn,spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { cp,mkdir,readFile,writeFile,unlink } from 'node:fs/promises'
import { resolve,join,basename,sep } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { expect,test } from 'vitest'
import { adminFixture,qrPng } from '../helpers/admin-fixture'
import { receiptPdf } from '../helpers/payment-fixture'

// Separate from the ordinary integration run. Only fresh, uniquely named local
// targets are restored; the source development database is never reset/restored.
test('restores synthetic database identities/history and actual private Storage bytes into an isolated stack',async()=>{
  const sourceUrl=new URL(process.env.SUPABASE_TEST_URL!)
  if(sourceUrl.hostname!=='127.0.0.1'||sourceUrl.port!=='54321')throw new Error('Restore drill requires the loopback BJBC test stack.')
  const project=`bjbc_restore_${randomUUID().replaceAll('-','').slice(0,10)}`,scratch=resolve('.superpowers',project)
  if(!/^bjbc_restore_[a-f0-9]{10}$/.test(project)||!scratch.startsWith(resolve('.superpowers')+sep))throw new Error('Unsafe restore target')
  const targetDb=`supabase_db_${project}`,targetStorage=`supabase_storage_${project}`
  const cli=resolve('node_modules/supabase/dist/supabase.js'),logs:string[]=[],sourceDb='supabase_db_bjbc'
  const binary=(name:string,args:string[],input?:string|Buffer,timeout=20000)=>{const r=spawnSync(name,args,{input,timeout,maxBuffer:64*1024*1024});if(r.status!==0){writeFileSync('.superpowers/task8-restore-error.private.log',r.stderr??Buffer.from('Process unavailable'));throw new Error('Restore drill command failed; raw provider/credential output suppressed.');}return r.stdout}
  const sql=(container:string,text:string)=>binary('docker',['exec','-i',container,'psql','-U','supabase_admin','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1'],text).toString().trim()
  const q=(s:string)=>`'${s.replaceAll("'","''")}'`
  const tables:[string,string][]=[['public.profiles','id'],['public.memberships','user_id'],['public.guests','id'],['public.players','id'],['public.sessions','id'],['public.polls','id'],['public.votes','id'],['public.participants','id'],['public.waitlist_offers','id'],['public.session_costs','session_id'],['public.fee_versions','id'],['public.charges','id'],['public.payments','id'],['public.notifications','id'],['public.audit_logs','id'],['public.club_settings','id'],['app_private.guest_access_tokens','id'],['app_private.guest_sessions','id'],['app_private.recovery_tokens','id'],['app_private.guest_operations','guest_id'],['app_private.operation_requests','actor_user_id'],['app_private.notification_outbox','id'],['app_private.identity_events','id'],['app_private.receipt_checks','object_id'],['app_private.payment_qr_checks','object_id'],['app_private.fee_cost_snapshots','fee_version_id']]
  type Snapshot={table:string;key:string;ids:string[];hash:string}
  type ObjectRecord={id:string;bucket_id:string;name:string;owner_id:string|null;version:string|null}
  const f=await adminFixture();let started=false,restored=false,targetService:ReturnType<typeof createClient>|null=null,functions:ReturnType<typeof spawn>|null=null
  const snapshots:Snapshot[]=[];let objects:ObjectRecord[]=[]
  const archives=[join(scratch,'database.sql'),join(scratch,'storage.tar')]
  let failure:unknown
  try{
    const sid=await f.session(),i=await f.invite(sid),session=await f.exchange(i.token),charge=await f.ready(sid,session)
    const submitted=await f.endpoint('guest-access',{action:'submit',chargeId:charge.id,requestId:randomUUID(),file:Buffer.from(receiptPdf).toString('base64'),mime:'application/pdf',extension:'pdf'},undefined,session)
    expect(submitted.status).toBe(200);const payment=await submitted.json()
    expect((await f.actors[0].client.rpc('review_payment',{payment_id_input:payment.payment_id,approve_input:true,bank_checked_input:true,reason_input:'Synthetic restore receipt checked',request_id:randomUUID()})).error).toBeNull()
    expect((await f.actors[0].client.rpc('verify_and_link_guest',{guest_id_input:i.guest_id,user_id_input:f.actors[1].uid,verified_input:true,reason_input:'Synthetic identity independently verified',request_id:randomUUID()})).error).toBeNull()
    const qr=`${randomUUID()}.png`;f.qrObjects.push(qr);expect((await f.actors[0].client.storage.from('payment-qr').upload(qr,qrPng,{contentType:'image/png'})).error).toBeNull();expect((await f.qrEndpoint(qr)).status).toBe(200)
    expect((await f.actors[0].client.rpc('save_club_settings',{bank_name_input:'Synthetic Restore Bank',bank_account_name_input:'Synthetic Club',bank_account_number_input:'00000000',qr_path_input:qr,expected_revision_input:0,recipient_checked_input:true,reason_input:'Synthetic restore recipient check',request_id:randomUUID()})).error).toBeNull()
    // Refuse to export unrelated identities/data from a developer's populated DB.
    const ids=f.actors.map(a=>a.uid).sort(),actual=JSON.parse(sql(sourceDb,"select coalesce(jsonb_agg(id order by id),'[]') from auth.users")) as string[]
    expect(actual.join(',')===ids.join(',')).toBe(true)
    objects=JSON.parse(sql(sourceDb,"select coalesce(jsonb_agg(jsonb_build_object('id',id,'bucket_id',bucket_id,'name',name,'owner_id',owner_id,'version',version)),'[]') from storage.objects")) as ObjectRecord[]
    expect(objects.length).toBe(2)
    const checksums:Record<string,string>={}
    for(const o of objects){const blob=await f.operator.storage.from(o.bucket_id).download(o.name);if(blob.error||!blob.data)throw new Error('Synthetic source object unavailable');checksums[`${o.bucket_id}/${o.name}`]=createHash('sha256').update(new Uint8Array(await blob.data.arrayBuffer())).digest('hex')}
    await mkdir(join(scratch,'supabase'),{recursive:true})
    let config=await readFile('supabase/config.toml','utf8');config=config.replace('project_id = "bjbc"',`project_id = "${project}"`).replaceAll('54321','54421').replaceAll('54322','54422').replaceAll('54320','54420').replaceAll('54323','54423')
    await writeFile(join(scratch,'supabase/config.toml'),config)
    await cp('supabase/migrations',join(scratch,'supabase/migrations'),{recursive:true})
    await cp('supabase/functions',join(scratch,'supabase/functions'),{recursive:true,filter:path=>!basename(path).startsWith('.env')})
    await writeFile(join(scratch,'function.env'),'BJBC_PUBLIC_SUPABASE_URL=http://127.0.0.1:54421\n')
    const existing=binary('docker',['ps','-a','--format','{{.Names}}']).toString().split(/\r?\n/);if(existing.includes(targetDb))throw new Error('Restore target already exists; preserved without mutation.')
    const startup=spawnSync(process.execPath,[cli,'start','--workdir',scratch,'--exclude','studio,realtime,logflare,vector,supavisor,mailpit'],{encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024})
    await writeFile(join(scratch,'startup.private.log'),startup.stdout+startup.stderr);logs.push(join(scratch,'startup.private.log'))
    if(startup.status!==0)throw new Error('Isolated stack startup failed; provider output is private.')
    started=true
    if(sql(targetDb,'select (select count(*) from auth.users)+(select count(*) from public.profiles)+(select count(*) from storage.objects)')!=='0')throw new Error('Restore target is not empty; no restore attempted.')
    const status=binary(process.execPath,[cli,'status','--workdir',scratch,'-o','json']).toString();const keys=JSON.parse(status)
    const targetUrl='http://127.0.0.1:54421',options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}
    targetService=createClient(targetUrl,keys.SERVICE_ROLE_KEY,options)
    for(const [table,key] of tables){snapshots.push({table,key,ids:JSON.parse(sql(sourceDb,`select coalesce(jsonb_agg(to_jsonb(t)->>${q(key)}),'[]') from ${table} t`)),hash:sql(sourceDb,`select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]')::text) from ${table} t`)})}
    const dump=binary('docker',['exec',sourceDb,'pg_dump','-U','supabase_admin','-d','postgres','--data-only','--inserts','--on-conflict-do-nothing','--disable-triggers','--schema=public','--schema=app_private','--schema=auth','--schema=storage'],undefined,60000)
    await writeFile(archives[0],dump)
    const storage=binary('docker',['exec','supabase_storage_bjbc','tar','-C','/mnt','-cf','-','.'],undefined,60000);await writeFile(archives[1],storage)
    restored=true
    binary('docker',['exec','-i',targetDb,'psql','-U','supabase_admin','-d','postgres','-X','-q','-v','ON_ERROR_STOP=1'],dump,60000)
    restored=true
    binary('docker',['exec','-i',targetStorage,'tar','-C','/mnt','-xf','-'],storage,60000)
    for(const snapshot of snapshots)expect(sql(targetDb,`select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]')::text) from ${snapshot.table} t`)===snapshot.hash).toBe(true)
    const restoredObjects=JSON.parse(sql(targetDb,"select coalesce(jsonb_agg(jsonb_build_object('id',id,'bucket_id',bucket_id,'name',name,'owner_id',owner_id,'version',version) order by id),'[]') from storage.objects")) as ObjectRecord[]
    expect(JSON.stringify(restoredObjects)===JSON.stringify([...objects].sort((a,b)=>a.id.localeCompare(b.id)))).toBe(true)
    for(const o of objects){const file=await targetService.storage.from(o.bucket_id).download(o.name);if(file.error||!file.data)throw new Error('Restored Storage bytes unavailable');expect(createHash('sha256').update(new Uint8Array(await file.data.arrayBuffer())).digest('hex')===checksums[`${o.bucket_id}/${o.name}`]).toBe(true)}
    const member=createClient(targetUrl,keys.ANON_KEY,options),signin=await member.auth.signInWithPassword({phone:f.actors[1].phone,password:f.actors[1].password});expect(signin.error).toBeNull()
    const own=await member.from('charges').select('id');expect(own.error).toBeNull();expect(own.data?.some(c=>c.id===charge.id)).toBe(true)
    const path=objects.find(o=>o.bucket_id==='receipts')!.name;expect((await member.rpc('authorize_receipt_view',{object_path_input:path})).data===path).toBe(true)
    functions=spawn(process.execPath,[cli,'functions','serve','receipt-view','--workdir',scratch,'--env-file',join(scratch,'function.env')],{stdio:'ignore'})
    let viewed:Response|null=null;const deadline=Date.now()+30000
    while(Date.now()<deadline){try{viewed=await fetch(`${targetUrl}/functions/v1/receipt-view`,{method:'POST',headers:{apikey:keys.ANON_KEY,Authorization:`Bearer ${signin.data.session!.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({path}),signal:AbortSignal.timeout(3000)});if(viewed.status===200)break}catch{/* Bounded startup wait; never print headers or errors. */}await new Promise(r=>setTimeout(r,500))}
    expect(viewed?.status).toBe(200);const privateLink=(await viewed!.json()).url,downloaded=await fetch(privateLink);expect(downloaded.status).toBe(200);expect(createHash('sha256').update(new Uint8Array(await downloaded.arrayBuffer())).digest('hex')===checksums[`receipts/${path}`]).toBe(true)
    await writeFile('.superpowers/task8-restore-report.json',JSON.stringify({passed:true,project,public_tables:16,table_snapshots:snapshots.length,auth_identities:ids.length,storage_objects:objects.length,checksums:Object.values(checksums),identity_login:true,linked_receipt_rls:true,private_receipt_download:true},null,2))
  }catch(error){failure=error}
  {
    functions?.kill()
    let cleanupFailure:unknown
    try{
    if(started&&restored&&targetService){
      for(const bucket of ['receipts','payment-qr']){const paths=objects.filter(o=>o.bucket_id===bucket).map(o=>o.name);if(paths.length&&(await targetService.storage.from(bucket).remove(paths)).error)throw new Error('Isolated restored object cleanup failed')}
      const byTable=new Map(snapshots.map(s=>[s.table,s])),remove=(table:string)=>{const s=byTable.get(table)!;return s.ids.length?`delete from ${table} t where to_jsonb(t)->>${q(s.key)} in (${s.ids.map(q).join(',')});`:''}
      const order=['app_private.guest_sessions','app_private.guest_operations','app_private.guest_access_tokens','app_private.recovery_tokens','app_private.operation_requests','app_private.notification_outbox','app_private.identity_events','app_private.receipt_checks','app_private.payment_qr_checks','public.audit_logs','public.notifications','public.payments','public.charges','app_private.fee_cost_snapshots','public.fee_versions','public.session_costs','public.waitlist_offers','public.votes','public.participants','public.polls','public.sessions','public.players','public.guests','public.club_settings']
      const userIds=f.actors.map(a=>q(a.uid)).join(',');sql(targetDb,`begin;update public.participants set merged_into_id=null where id in (${(byTable.get('public.participants')?.ids??[]).map(q).join(',')||'null'});update public.memberships set approved_by=null where user_id in (${userIds});${order.map(remove).join('\n')}commit;`)
      for(const actor of f.actors)if((await targetService.auth.admin.deleteUser(actor.uid)).error)throw new Error('Restored synthetic identity cleanup failed')
      if(sql(targetDb,'select (select count(*) from auth.users)+(select count(*) from public.profiles)+(select count(*) from public.sessions)+(select count(*) from public.charges)+(select count(*) from public.audit_logs)+(select count(*) from storage.objects)')!=='0')throw new Error('Isolated stack cleanup incomplete; stack preserved.')
      binary(process.execPath,[cli,'stop','--workdir',scratch,'--no-backup'],undefined,60000)
    }else if(started&&!restored){if(sql(targetDb,'select (select count(*) from auth.users)+(select count(*) from storage.objects)')==='0')binary(process.execPath,[cli,'stop','--workdir',scratch,'--no-backup'],undefined,60000)}
    }catch(error){cleanupFailure=error}finally{
      for(const file of [...archives,...logs])await unlink(file).catch(()=>{})
      await f.cleanup()
    }
    if(cleanupFailure&&!failure)failure=cleanupFailure
  }
  if(failure)throw failure
})

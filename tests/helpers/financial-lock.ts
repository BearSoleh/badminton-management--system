import { spawn } from 'node:child_process'
import { localSql,sqlLiteral as q } from './local-sql'
export async function holdSession(sid:string) {
  const child=spawn('docker',['exec','-i','supabase_db_bjbc','psql','-U','postgres','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1'])
  child.stderr.resume()
  const done=new Promise<void>((resolve,reject)=>{child.on('error',()=>reject(new Error('Financial lock failed')));child.on('exit',c=>c===0?resolve():reject(new Error('Financial lock failed')))})
  await new Promise<void>((resolve,reject)=>{let buffer='';const timer=setTimeout(()=>reject(new Error('Financial lock timed out')),5000);child.stdout.on('data',chunk=>{buffer+=String(chunk);if(buffer.includes('TASK6_HELD')){clearTimeout(timer);resolve()}});child.stdin.write(`begin;select id from public.sessions where id=${q(sid)} for update;select 'TASK6_HELD';\n`)})
  return async()=>{child.stdin.end('commit;\n');await done}
}
export async function financialCallsBlocked() {
  const until=Date.now()+7000
  while(Date.now()<until){if(Number(localSql("select count(*) from pg_stat_activity where wait_event_type='Lock' and (query like '%review_payment%' or query like '%cancel_session%' or query like '%submit_payment%' or query like '%record_cash_payment%' or query like '%adjust_session_fee%')"))>=2)return;await new Promise(r=>setTimeout(r,50))}
  throw new Error('Financial calls did not reach database lock')
}

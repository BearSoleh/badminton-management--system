import { spawnSync } from 'node:child_process'

// Inspect locally captured output in memory only. Assertion failures print a
// boolean, never a log line or secret. No command-line secret arguments.
export function runtimeLogsContain(values:string[]):boolean {
  for(const name of ['supabase_edge_runtime_bjbc','supabase_kong_bjbc','supabase_auth_bjbc','supabase_db_bjbc']) {
    const result=spawnSync('docker',['logs','--since','5m',name],{encoding:'utf8',maxBuffer:20*1024*1024})
    if(result.status!==0)throw new Error('Local runtime log inspection unavailable; raw output suppressed.')
    if(values.some(value=>(result.stdout+result.stderr).includes(value)))return true
  }
  return false
}

import { spawnSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { pilotOrigin,pilotHeaders } from '../src/lib/pilot.ts'
let origin
try{origin=pilotOrigin(process.env.VITE_SUPABASE_URL);if(!process.env.VITE_SUPABASE_PUBLISHABLE_KEY)throw new Error('Missing public key')}
catch{console.error('Pilot build blocked: configure the hosted HTTPS Supabase URL and public publishable key in private .env.pilot.local. Existing local env files were not changed.');process.exit(1)}
for(const args of [['node_modules/typescript/bin/tsc','-b'],['node_modules/vite/bin/vite.js','build','--mode','pilot']]){
  const result=spawnSync(process.execPath,args,{stdio:'inherit'});if(result.status!==0)process.exit(result.status??1)
}
await writeFile('dist/_headers',pilotHeaders(origin))
console.log('Pilot build prepared with a project-specific CSP. Verify Cloudflare Access before deploying; this build does not establish access protection.')

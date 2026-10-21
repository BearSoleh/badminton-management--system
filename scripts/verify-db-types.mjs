import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import ts from 'typescript'

// Compare our public API contracts with official output without replacing the
// checked-in file. Never print CLI stderr: provider errors can contain URLs/keys.
const result = spawnSync(process.execPath, ['node_modules/supabase/dist/supabase.js', 'gen', 'types', 'typescript', '--local', '--schema', 'public'], { encoding: 'utf8' })
if (result.status !== 0 || !result.stdout.includes('export type Database')) {
  console.error('Official local Supabase type generation unavailable. Start the local stack first. Existing types were not changed; raw provider output suppressed.')
  process.exit(1)
}
await mkdir('.superpowers', { recursive: true })
await writeFile('.superpowers/database.official.ts', result.stdout)
const checks = [
  "Check<Equal<keyof Local['public']['Tables'], keyof Official['public']['Tables']>>",
  "Check<Equal<keyof Local['public']['Functions'], keyof Official['public']['Functions']>>",
]
for (const table of ['profiles', 'memberships']) {
  for (const shape of ['Row', 'Insert', 'Update', 'Relationships']) {
    checks.push(`Check<Equal<Local['public']['Tables']['${table}']['${shape}'], Official['public']['Tables']['${table}']['${shape}']>>`)
  }
}
for (const fn of ['get_my_membership', 'assert_active_membership', 'update_my_display_name']) {
  checks.push(`Check<Equal<Local['public']['Functions']['${fn}'], Official['public']['Functions']['${fn}']>>`)
}
await writeFile('.superpowers/compare-types.ts', `
import type { Database as Local } from '../src/types/database.ts'
import type { Database as Official } from './database.official.ts'
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type Check<T extends true> = T
export type Contracts = [${checks.join(',\n')}]
`)
const program = ts.createProgram(['.superpowers/compare-types.ts'], {
  noEmit: true, strict: true, skipLibCheck: true, allowImportingTsExtensions: true,
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
})
const diagnostics = ts.getPreEmitDiagnostics(program)
if (diagnostics.length) {
  for (const diagnostic of diagnostics) console.error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
  process.exit(1)
}
console.log(`${checks.length} public schema contracts match the official Supabase generator: table/function names, Row/Insert/Update/Relationships and RPC Args/Returns.`)

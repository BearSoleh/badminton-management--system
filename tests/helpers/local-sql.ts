import { spawnSync } from 'node:child_process'

// Trusted fixture/setup access for the local disposable BJBC stack only.
// SQL is sent through stdin, never through a shell or command-line credentials.
export function localSql(statement: string): string {
  const result = spawnSync('docker', ['exec', '-i', 'supabase_db_bjbc', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-At'], {
    input: statement, encoding: 'utf8', timeout: 10000,
  })
  if (result.status !== 0) {
    const known = ['PHONE_CHANGE_REQUIRES_ADMIN_VERIFICATION', 'ADMIN_ALREADY_EXISTS', 'permission denied'].find((message) => result.stderr?.includes(message))
    throw new Error(known ?? 'Trusted local fixture SQL failed; raw output suppressed.')
  }
  return result.stdout.trim()
}

export function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

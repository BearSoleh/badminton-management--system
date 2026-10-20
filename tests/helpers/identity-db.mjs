import { PGlite } from '@electric-sql/pglite'
import { readFile, readdir } from 'node:fs/promises'

// Test-only stand-in for the Auth-owned schema. PostgreSQL/RLS/PLpgSQL are real;
// this fixture does not emulate GoTrue signup, session refresh or password storage.
export async function createIdentityDatabase() {
  const db = new PGlite()
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create role supabase_auth_admin nologin;
    create schema auth;
    create table auth.users (id uuid primary key, phone text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `)
  let migrations = []
  try { migrations = (await readdir('supabase/migrations')).filter((name) => name.endsWith('.sql')).sort() }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  for (const migration of migrations) await db.exec(await readFile(`supabase/migrations/${migration}`, 'utf8'))
  return db
}

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
    -- Storage-owned fixture for offline migration/RLS checks only. Real upload,
    -- MIME/size enforcement and signed URLs are verified against Storage itself.
    create schema storage;
    create table storage.buckets (
      id text primary key, name text not null, public boolean default false,
      file_size_limit bigint, allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
      name text not null, owner_id text, metadata jsonb, unique(bucket_id,name)
    );
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated, service_role;
    grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
  `)
  let migrations = []
  try { migrations = (await readdir('supabase/migrations')).filter((name) => name.endsWith('.sql')).sort() }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  for (const migration of migrations) await db.exec(await readFile(`supabase/migrations/${migration}`, 'utf8'))
  return db
}

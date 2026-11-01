import { randomBytes } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { coreFixtureSql, fixtureId as id, type CoreActors } from '../helpers/core-fixture'
import { localSql, sqlLiteral } from '../helpers/local-sql'

const url = process.env.SUPABASE_TEST_URL!
const key = process.env.SUPABASE_TEST_PUBLISHABLE_KEY!
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
const operator = createClient(url, process.env.SUPABASE_TEST_SECRET_KEY!, options)
const publicClient = () => createClient(url, key, options)
type Actor = { client: SupabaseClient; uid?: string; token?: string }
const actors: Record<string, Actor> = {}
const createdUsers: string[] = []
const objectPaths: string[] = []
const pdf = new TextEncoder().encode('%PDF-1.4\nSynthetic receipt fixture only\n%%EOF')
let users: CoreActors
let ownPath: string
let seeded = false

async function ensureReceipt(label = 'a') {
  const path = label === 'suspended' ? `${users.suspended}/${id(53)}/${id(74)}.pdf` : ownPath
  if ((await operator.storage.from('receipts').info(path)).error) {
    objectPaths.push(path)
    expect((await actors[label].client.storage.from('receipts').upload(path, pdf, { contentType: 'application/pdf' })).error).toBeNull()
  }
  return path
}

async function view(actor: Actor, path: string, extra: object = {}) {
  return fetch(`${url}/functions/v1/receipt-view`, { method: 'POST', headers: { apikey: key, ...(actor.token ? { Authorization: `Bearer ${actor.token}` } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify({ path, ...extra }) })
}
async function readIds(client: SupabaseClient, table: string) {
  const r = await client.from(table).select('id')
  expect(r.error?.code, `${table} reads are defined`).toBeUndefined()
  return r.data!.map((row) => row.id)
}

describe('real PostgREST and private Storage actor matrix', () => {
  beforeAll(async () => {
    const schema = await operator.from('charges').select('id').limit(0)
    expect(schema.error?.code, 'Task 2 migrations must exist before running permissions').toBeUndefined()
    actors.public = { client: publicClient() }
    // A guest invitation is not a Supabase user/session. Even forged guest headers
    // and a guessed token cannot grant direct PostgREST/Storage access in Task 2.
    actors.guest = { client: createClient(url, key, { ...options, global: { headers: { 'x-guest-id': id(1), 'x-guest-token': 'synthetic-forged-capability' } } }) }
    let i = 0
    for (const label of ['a', 'b', 'pending', 'suspended', 'admin']) {
      const phone = `+60112${String(Date.now() + i++).slice(-7)}`
      const password = randomBytes(24).toString('base64url')
      const created = await operator.auth.admin.createUser({ phone, password, phone_confirm: true, user_metadata: { display_name: `Synthetic ${label}` } })
      expect(created.error?.code).toBeUndefined()
      const uid = created.data.user!.id
      createdUsers.push(uid)
      const client = publicClient()
      const login = await client.auth.signInWithPassword({ phone, password })
      expect(login.error?.code).toBeUndefined()
      actors[label] = { client, uid, token: login.data.session!.access_token }
    }
    users = Object.fromEntries(Object.entries(actors).filter(([, a]) => a.uid).map(([label, a]) => [label, a.uid])) as CoreActors
    // Atomic seeding: an existing/colliding fixture ID must roll back rather
    // than make cleanup delete records this run did not create.
    localSql(`begin; ${coreFixtureSql(users)} commit;`)
    seeded = true
    ownPath = `${users.a}/${id(51)}/${id(71)}.pdf`
  }, 30000)
  afterAll(async () => {
    // Only exact fixture paths/IDs owned by this suite. No database reset.
    if (objectPaths.length) expect((await operator.storage.from('receipts').remove(objectPaths)).error).toBeNull()
    if (seeded) localSql(`begin;
      select id from public.sessions where id in ('${id(20)}','${id(21)}') order by id for update;
      delete from public.audit_logs where id='${id(90)}' or entity_id in ('${id(31)}','${id(32)}','${id(33)}','${id(34)}')
        or entity_id in(select id from public.waitlist_offers where participant_id in ('${id(31)}','${id(32)}','${id(33)}','${id(34)}'));
      delete from public.notifications where id in ('${id(80)}','${id(81)}');
      delete from public.payments where charge_id in ('${id(51)}','${id(52)}','${id(53)}');
      delete from public.charges where session_id in ('${id(20)}','${id(21)}');
      delete from public.fee_versions where id='${id(40)}';
      delete from public.waitlist_offers where participant_id in ('${id(31)}','${id(32)}','${id(33)}','${id(34)}');
      delete from public.participants where id in ('${id(31)}','${id(32)}','${id(33)}','${id(34)}');
      delete from public.polls where id='${id(25)}';
      delete from public.sessions where id in ('${id(20)}','${id(21)}');
      delete from public.players where id in ('${id(11)}','${id(12)}','${id(13)}','${id(14)}');
      delete from public.guests where id='${id(1)}';
      commit;
    `)
    for (const uid of createdUsers) expect((await operator.auth.admin.deleteUser(uid)).error?.code).toBeUndefined()
  })

  it.each(['public', 'guest'])('%s cannot read private tables, call roster RPC or claim receipt access', async (label) => {
    const { client } = actors[label]
    for (const table of ['profiles', 'sessions', 'participants', 'charges', 'payments', 'notifications', 'audit_logs']) expect((await client.from(table).select('*')).error?.code).toBe('42501')
    expect((await client.rpc('get_session_roster', { session_id_input: id(20) })).error?.code).toBe('42501')
    expect((await view(actors[label], ownPath)).status).toBe(401)
  })
  it.each(['pending', 'suspended'])('%s cannot read sessions/rosters, while suspended keeps own obligations', async (label) => {
    expect(await readIds(actors[label].client, 'sessions')).toEqual([])
    const roster = await actors[label].client.rpc('get_session_roster', { session_id_input: id(20) })
    expect(roster.error).toBeNull(); expect(roster.data).toEqual([])
    expect(await readIds(actors[label].client, 'charges')).toEqual(label === 'suspended' ? [id(53)] : [])
  })
  it('A and B see safe rosters and own identities/charges only; draft projection is empty', async () => {
    for (const label of ['a', 'b']) {
      const actor = actors[label]
      expect(await readIds(actor.client, 'sessions')).toEqual([id(20)])
      expect(await readIds(actor.client, 'profiles')).toEqual([actor.uid])
      const roster = await actor.client.rpc('get_session_roster', { session_id_input: id(20) })
      expect(roster.error).toBeNull(); expect(roster.data).toHaveLength(4)
      expect(Object.keys(roster.data[0]).sort()).toEqual(['session_id', 'participant_id', 'display_name', 'participation_status', 'attendance'].sort())
      expect((await actor.client.rpc('get_session_roster', { session_id_input: id(21) })).data).toEqual([])
    }
    expect(await readIds(actors.a.client, 'charges')).toEqual([id(51)])
    expect(await readIds(actors.b.client, 'charges')).toEqual([id(52)])
    expect(await readIds(actors.a.client, 'payments')).toEqual([])
    expect(await readIds(actors.b.client, 'payments')).toEqual([id(60)])
    expect(await readIds(actors.a.client, 'notifications')).toEqual([id(80)])
  })
  it('active admin sees records; current database suspension revokes admin reads with same JWT', async () => {
    expect(await readIds(actors.admin.client, 'charges')).toHaveLength(3)
    expect(await readIds(actors.admin.client, 'audit_logs')).toEqual([id(90)])
    localSql(`update public.memberships set status='suspended' where user_id=${sqlLiteral(users.admin)}`)
    try { expect(await readIds(actors.admin.client, 'audit_logs')).toEqual([]); expect(await readIds(actors.admin.client, 'sessions')).toEqual([]) }
    finally { localSql(`update public.memberships set status='active' where user_id=${sqlLiteral(users.admin)}`) }
  })
  it.each(['a', 'admin'])('%s cannot directly promote, change phones, approve payments or replace receipt paths', async (label) => {
    const client = actors[label].client
    for (const [table, patch] of [['memberships', { role: 'admin' }], ['profiles', { phone: '+60123456789' }], ['payments', { status: 'approved' }], ['payments', { receipt_object_path: ownPath }], ['charges', { status: 'paid' }]] as const) {
      const identityColumn = table === 'memberships' ? 'user_id' : 'id'
      expect((await client.from(table).update(patch).not(identityColumn, 'is', null)).error?.code).toBe('42501')
    }
    expect((await client.rpc('review_payment', { payment_id: id(60), approve: true })).error?.code).toBe('PGRST202')
    expect((await client.schema('app_private').from('guest_access_tokens').select('*')).error?.code).toBe('PGRST106')
    expect((await client.from('guest_access_tokens').select('*')).error?.code).toBe('PGRST205')
  })
  it('bucket is private, bounded to 5 MiB and JPEG/PNG/PDF', async () => {
    const result = await operator.storage.getBucket('receipts')
    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({ public: false, file_size_limit: 5242880, allowed_mime_types: ['image/jpeg', 'image/png', 'application/pdf'] })
  })
  it('own charge upload succeeds; receipt guesses, foreign charges and path tricks fail', async () => {
    objectPaths.push(ownPath)
    expect((await actors.a.client.storage.from('receipts').upload(ownPath, pdf, { contentType: 'application/pdf' })).error).toBeNull()
    const suspendedPath = `${users.suspended}/${id(53)}/${id(74)}.pdf`
    objectPaths.push(suspendedPath)
    expect((await actors.suspended.client.storage.from('receipts').upload(suspendedPath, pdf, { contentType: 'application/pdf' })).error).toBeNull()
    for (const [label, path] of [['a', `${users.a}/${id(52)}/${id(72)}.pdf`], ['b', `${users.a}/${id(51)}/${id(73)}.pdf`], ['pending', `${users.pending}/${id(51)}/${id(74)}.pdf`], ['guest', ownPath], ['a', `${users.a}/${id(51)}/../${id(72)}.pdf`], ['a', `${users.a}/${id(51)}/${id(72)}.svg`]]) {
      const result = await actors[label].client.storage.from('receipts').upload(path, pdf, { contentType: 'application/pdf' })
      expect(result.error, 'unauthorized upload must fail').not.toBeNull()
    }
    expect((await actors.a.client.storage.from('receipts').upload(ownPath, pdf, { contentType: 'application/pdf', upsert: true })).error).not.toBeNull()
    expect((await actors.a.client.storage.from('receipts').update(ownPath, pdf, { contentType: 'application/pdf' })).error).not.toBeNull()
  })
  it('Storage rejects unsupported MIME and oversized files on an otherwise authorized path', async () => {
    for (const [body, contentType] of [[new Uint8Array(5242881), 'application/pdf'], [pdf, 'image/svg+xml']] as const) {
      expect((await actors.a.client.storage.from('receipts').upload(`${users.a}/${id(51)}/${id(75)}.pdf`, body, { contentType })).error).not.toBeNull()
    }
  })
  it('client listing/deletion/copy cannot expose or overwrite receipt history', async () => {
    await ensureReceipt()
    expect((await actors.a.client.storage.from('receipts').list(users.a)).data).toEqual([])
    await actors.a.client.storage.from('receipts').remove([ownPath])
    expect((await operator.storage.from('receipts').info(ownPath)).error).toBeNull()
    expect((await actors.a.client.storage.from('receipts').copy(ownPath, `${users.a}/${id(51)}/${id(76)}.pdf`)).error).not.toBeNull()
  })
  it('receipt endpoint rejects invalid bearer credentials, methods and request shapes', async () => {
    expect((await view({ client: publicClient(), token: 'synthetic-invalid-jwt' }, ownPath)).status).toBe(401)
    const headers = { apikey: key, Authorization: `Bearer ${actors.a.token}`, 'Content-Type': 'application/json' }
    expect((await fetch(`${url}/functions/v1/receipt-view`, { method: 'GET', headers })).status).toBe(405)
    for (const body of ['not JSON', '{"path":42}', JSON.stringify({ path: 'x'.repeat(2049) })]) {
      expect((await fetch(`${url}/functions/v1/receipt-view`, { method: 'POST', headers, body })).status).toBe(400)
    }
  })
  it('all client signing/public downloads are blocked; authorized viewing returns a fixed 60-second URL', async () => {
    await ensureReceipt(); await ensureReceipt('suspended')
    for (const label of ['a', 'b', 'admin']) {
      expect((await actors[label].client.storage.from('receipts').createSignedUrl(ownPath, 86400)).error).not.toBeNull()
      expect((await actors[label].client.storage.from('receipts').download(ownPath)).error).not.toBeNull()
    }
    expect((await fetch(`${url}/storage/v1/object/public/receipts/${ownPath}`)).ok).toBe(false)
    for (const label of ['b', 'pending', 'guest']) expect((await view(actors[label], ownPath)).status).toBe(label === 'guest' ? 401 : 403)
    expect((await view(actors.a, `${users.a}/${id(51)}/${id(999)}.pdf`)).status).toBe(403)
    for (const label of ['a', 'admin', 'suspended']) {
      const path = label === 'suspended' ? `${users.suspended}/${id(53)}/${id(74)}.pdf` : ownPath
      const response = await view(actors[label], path, { expiresIn: 86400 })
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      const result = await response.json()
      expect(result.expiresIn).toBe(60)
      const signed = new URL(result.url)
      expect(signed.origin).toBe(new URL(url).origin)
      expect(signed.pathname).toContain('/object/sign/receipts/')
      const claims = JSON.parse(Buffer.from(signed.searchParams.get('token')!.split('.')[1], 'base64url').toString())
      expect(claims.exp - claims.iat).toBe(60)
      const download = await fetch(result.url)
      expect(download.status).toBe(200)
      expect(new Uint8Array(await download.arrayBuffer())).toEqual(pdf)
    }
  })
  it('membership changes revoke fresh receipt URLs immediately, with existing URLs bounded by expiry', async () => {
    await ensureReceipt()
    localSql(`update public.memberships set status='rejected' where user_id=${sqlLiteral(users.a)}`)
    try { expect((await view(actors.a, ownPath)).status).toBe(403) }
    finally { localSql(`update public.memberships set status='active' where user_id=${sqlLiteral(users.a)}`) }
    const response = await view(actors.a, ownPath)
    expect(response.status).toBe(200)
    const result = await response.json()
    // Short timer intervals keep this test's wait asynchronous; the tool runner
    // yields while the actual 60-second Storage token lifetime elapses.
    const expires = Date.now() + 62000
    while (Date.now() < expires) await new Promise((resolve) => setTimeout(resolve, Math.min(15000, expires - Date.now())))
    expect((await fetch(result.url)).ok, 'actual Storage must reject the expired bearer URL').toBe(false)
  }, 70000)
})

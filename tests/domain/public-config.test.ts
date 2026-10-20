import { describe, expect, it } from 'vitest'
import { publicSupabaseConfig } from '../../src/lib/public-config'

const token = (role: string) => `header.${btoa(JSON.stringify({ role }))}.synthetic-signature`
describe('browser credential boundary', () => {
  it('accepts a publishable key over HTTPS or local HTTP', () => {
    expect(publicSupabaseConfig('https://example.supabase.co', 'sb_publishable_fixture')).toEqual({ url: 'https://example.supabase.co', key: 'sb_publishable_fixture' })
    expect(publicSupabaseConfig('http://127.0.0.1:54321', token('anon'))).not.toBeNull()
  })
  it('rejects backend secrets and service-role JWTs', () => {
    expect(publicSupabaseConfig('https://example.supabase.co', 'sb_secret_not-a-real-key')).toBeNull()
    expect(publicSupabaseConfig('https://example.supabase.co', token('service_role'))).toBeNull()
  })
  it('refuses to send login credentials over non-local plaintext HTTP', () => {
    expect(publicSupabaseConfig('http://example.com', 'sb_publishable_fixture')).toBeNull()
  })
  it('handles missing or malformed configuration without leaking its input', () => {
    expect(publicSupabaseConfig(undefined, undefined)).toBeNull()
    expect(publicSupabaseConfig('not a URL', token('anon'))).toBeNull()
    expect(publicSupabaseConfig('https://example.supabase.co', 'malformed')).toBeNull()
  })
})

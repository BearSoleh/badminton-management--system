import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// HTTP fixtures exercise our real UI and Supabase client boundary, not GoTrue.
const userId = '00000000-0000-4000-8000-000000000001'
export async function authFixture(page: Page, status = 'pending') {
  let displayName = 'Bear'
  const user = { id: userId, aud: 'authenticated', role: 'authenticated', phone: '60123456789',
    app_metadata: { provider: 'phone', providers: ['phone'] }, user_metadata: { display_name: 'Bear' },
    identities: [], created_at: '2026-10-20T00:00:00Z', updated_at: '2026-10-20T00:00:00Z' }
  const jwtPayload = Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })).toString('base64url')
  const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${jwtPayload}.fixture`, refresh_token: 'fixture-refresh-token',
    token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user }
  await page.route('http://127.0.0.1:54321/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/signup')) {
      const data = route.request().postDataJSON()
      expect(data.phone).toBe('+60123456789')
      expect(data.data).toEqual({ display_name: 'Bear' })
      return route.fulfill({ json: session })
    }
    if (url.pathname.endsWith('/token')) return route.fulfill({ json: session })
    if (url.pathname.endsWith('/user')) return route.fulfill({ json: user })
    if (url.pathname.endsWith('/logout')) return route.fulfill({ status: 204 })
    if (url.pathname.endsWith('/rpc/get_my_membership')) return route.fulfill({ json: [{ user_id: userId, display_name: displayName, phone: '+60123456789', role: 'member', status }] })
    if (url.pathname.endsWith('/rpc/update_my_display_name')) {
      displayName = route.request().postDataJSON().display_name_input
      return route.fulfill({ status: 204 })
    }
    if (url.pathname === '/rest/v1/sessions') return route.fulfill({ json: [] })
    if (url.pathname === '/rest/v1/rpc/get_active_offers') return route.fulfill({ json: {server_now:new Date().toISOString(),offers:[]} })
    return route.fulfill({ status: 404, json: { message: 'Unrecognized test request' } })
  })
}
export async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Phone number').fill('0123456789')
  await page.getByLabel('Password', { exact: true }).fill('a-long-test-password')
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
}

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// HTTP fixtures exercise our real UI and Supabase client boundary, not GoTrue.
const userId = '00000000-0000-4000-8000-000000000001'
async function authFixture(page: Page, status = 'pending') {
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
    return route.fulfill({ status: 404, json: { message: 'Unrecognized test request' } })
  })
}
async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Phone number').fill('0123456789')
  await page.getByLabel('Password', { exact: true }).fill('a-long-test-password')
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
}

test('English registration sends canonical phone and shows pending approval', async ({ page }) => {
  await authFixture(page)
  await page.goto('/register')
  await page.getByLabel('Name or nickname').fill(' Bear ')
  await page.getByLabel('Phone number').fill('012-345 6789')
  await page.getByLabel('Password', { exact: true }).fill('a-long-test-password')
  await page.getByLabel('I understand').check()
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'You’re on the list.' })).toBeVisible()
  await expect(page).toHaveURL(/account-status/)
  await expect(page.getByRole('link', { name: 'Sessions', exact: true })).toHaveCount(0)
})
test('pending member cannot open member routes and can log out', async ({ page }) => {
  await authFixture(page)
  await login(page)
  await expect(page).toHaveURL(/account-status/)
  await page.goto('/app/profile')
  await expect(page).toHaveURL(/account-status/)
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/login/)
})
test('active account opens a genuine empty foundation and profile', async ({ page }) => {
  await authFixture(page, 'active')
  await login(page)
  await expect(page.getByRole('heading', { name: 'Welcome back, Bear.' })).toBeVisible()
  await page.getByRole('link', { name: 'Your profile' }).click()
  await expect(page.getByLabel('Name or nickname')).toHaveValue('Bear')
  await expect(page.getByText('Phone changes require admin verification.')).toBeVisible()
})
test('active member can save a nickname and see the new identity', async ({ page }) => {
  await authFixture(page, 'active')
  await login(page)
  await page.getByRole('link', { name: 'Your profile' }).click()
  await page.getByLabel('Name or nickname').fill('Captain Bear')
  await page.getByRole('button', { name: 'Save name' }).click()
  await expect(page.getByRole('status')).toHaveText('Your name has been updated.')
  await page.getByRole('link', { name: 'Back to your club' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back, Captain Bear.' })).toBeVisible()
})
test('suspended member sees restrictions without a join action', async ({ page }) => {
  await authFixture(page, 'suspended')
  await login(page)
  await expect(page.getByRole('heading', { name: 'Membership suspended' })).toBeVisible()
  await expect(page.getByText(/existing payment obligations/)).toBeVisible()
})
test('invalid login shows safe error without provider internals', async ({ page }) => {
  await page.route('http://127.0.0.1:54321/auth/v1/token**', (route) => route.fulfill({ status: 400, json: { error_code: 'invalid_credentials', msg: 'Internal provider detail' } }))
  await login(page)
  await expect(page.getByRole('alert')).toContainText('Unable to log in. Check your phone number and password, then try again.')
  await expect(page.getByText('Internal provider detail')).toHaveCount(0)
})
test('an expired server session returns safely to login', async ({ page }) => {
  await authFixture(page, 'active')
  await login(page)
  await expect(page.getByRole('heading', { name: 'Welcome back, Bear.' })).toBeVisible()
  await page.route('http://127.0.0.1:54321/rest/v1/rpc/get_my_membership', (route) => route.fulfill({ status: 401, json: { code: 'PGRST303', message: 'JWT expired' } }))
  await page.reload()
  await expect(page).toHaveURL(/login/)
})
test('mobile layout fits the viewport and exposes keyboard focus', async ({ page }, testInfo) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Good to see you.' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
  await page.keyboard.press('Escape')
  await page.getByLabel('Phone number').click()
  await page.screenshot({ path: `test-results/auth-${testInfo.project.name}.png`, fullPage: true })
})

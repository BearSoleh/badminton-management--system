import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'

// No route interception: React, Auth, PostgREST and PostgreSQL are all live.
// The backend secret is used in this Node test process only, never page code.
test('real registration, pending guard, approval, phone login, profile and logout', async ({ page }) => {
  const admin = createClient(process.env.SUPABASE_TEST_URL!, process.env.SUPABASE_TEST_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const phone = `+60112${String(Date.now()).slice(-7)}`
  const nickname = 'Synthetic Browser Member'
  let userId: string | undefined
  try {
    await page.goto('/register')
    await page.getByLabel('Name or nickname').fill(nickname)
    await page.getByLabel('Phone number').fill(`0${phone.slice(3)}`)
    await page.getByLabel('Password', { exact: true }).fill('Synthetic-browser-test-password-42!')
    await page.getByLabel('I understand').check()
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByRole('heading', { name: 'You’re on the list.' })).toBeVisible()
    const record = await admin.from('profiles').select('id').eq('phone', phone).single()
    expect(record.error?.code).toBeUndefined()
    userId = record.data!.id
    await page.goto('/app/profile')
    await expect(page).toHaveURL(/account-status/)
    await page.getByRole('button', { name: 'Log out' }).click()
    await expect(page).toHaveURL(/login/)
    expect((await admin.from('memberships').update({ status: 'active', approved_at: new Date().toISOString() }).eq('user_id', userId)).error?.code).toBeUndefined()
    await page.getByLabel('Phone number').fill(phone)
    await page.getByLabel('Password', { exact: true }).fill('Synthetic-browser-test-password-42!')
    await page.getByRole('button', { name: 'Log in', exact: true }).click()
    await expect(page.getByRole('heading', { name: `Welcome back, ${nickname}.` })).toBeVisible()
    await page.getByRole('link', { name: 'Your profile' }).click()
    await page.getByLabel('Name or nickname').fill('Synthetic Updated Nickname')
    await page.getByRole('button', { name: 'Save name' }).click()
    await expect(page.getByRole('status')).toHaveText('Your name has been updated.')
    const updated = await admin.from('profiles').select('display_name').eq('id', userId).single()
    expect(updated.data?.display_name).toBe('Synthetic Updated Nickname')
    await page.getByRole('button', { name: 'Log out' }).click()
    await expect(page).toHaveURL(/login/)
    await page.goto('/app')
    await expect(page).toHaveURL(/login/)
  } finally {
    if (!userId) {
      const record = await admin.from('profiles').select('id').eq('phone', phone).maybeSingle()
      userId = record.data?.id
    }
    if (userId) expect((await admin.auth.admin.deleteUser(userId)).error?.code, 'remove own synthetic browser fixture').toBeUndefined()
  }
})

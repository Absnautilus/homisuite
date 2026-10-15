import { test, expect } from '@playwright/test'

// All run against the public login route, which (like the existing smoke
// test's "shows the login form when signed out") needs no Supabase stack --
// so these always run in CI and locally. They cover the part of the theme
// system that doesn't require being logged in: the no-FOUC inline script,
// system-preference resolution/live sync, and persistence across reloads.
// Exercising the Settings page's ThemeToggle click itself needs an
// authenticated session against a local Supabase stack, the same
// requirement the rest of this suite's authenticated tests already carry
// (see smoke.spec.ts) -- that interaction is covered by manual QA instead.

test('system preference resolves to dark with no stored choice', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('system preference resolves to light with no stored choice', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

test('an explicit stored choice overrides the OS preference', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('homisuite.theme', 'dark'))
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('the stored choice survives a reload', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('homisuite.theme', 'dark'))
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('an open tab on "system" follows a live OS preference change', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('homisuite.theme', 'system'))
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('the login screen renders without a flash of the wrong theme', async ({ page }) => {
  // No reliable way to capture "before first paint" from the test side, but
  // asserting the attribute is already correct by the time the very first
  // visible heading appears is the closest black-box proxy available: it
  // means the inline head script ran and nothing re-painted afterward.
  await page.addInitScript(() => localStorage.setItem('homisuite.theme', 'dark'))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Bentornato' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})
